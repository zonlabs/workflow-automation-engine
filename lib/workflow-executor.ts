import supabase from './supabase';
import { executeMCPTool } from './mcp-executor';

interface WorkflowStep {
  step_number: number;
  toolkit: string;
  tool_slug: string;
  tool_arguments: Record<string, any>;
  depends_on_step_id?: string;
  output_mapping?: Record<string, string>;
  timeout_seconds?: number;
  max_retries?: number;
  run_if_condition?: Record<string, any>;
}

interface ExecutionContext {
  workflow_id: string;
  scheduled_workflow_id: string;
  user_id: string;
  execution_log_id: string;
  params: Record<string, any>;
  stepOutputs?: Record<number, any>;
}

// Resolve variables in arguments (e.g., {{params.xxx}}, {{steps.0.output}})
function resolveVariables(
  args: Record<string, any>,
  params: Record<string, any>,
  stepOutputs: Record<number, any>
): Record<string, any> {
  const resolved = JSON.parse(JSON.stringify(args));

  function replaceValue(value: any): any {
    if (typeof value === 'string') {
      return value
        .replace(/\{\{params\.([^}]+)\}\}/g, (_, key) => params[key] ?? '')
        .replace(/\{\{steps\.(\d+)\.([^}]+)\}\}/g, (_, step, path) => {
          const stepOutput = stepOutputs[parseInt(step)];
          return getNestedValue(stepOutput, path) ?? '';
        });
    } else if (typeof value === 'object' && value !== null) {
      return Array.isArray(value)
        ? value.map(replaceValue)
        : Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, replaceValue(v)])
          );
    }
    return value;
  }

  return replaceValue(resolved);
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main workflow executor
export async function executeWorkflow(
  context: ExecutionContext
): Promise<any> {
  const {
    workflow_id,
    scheduled_workflow_id,
    user_id,
    execution_log_id,
    params,
  } = context;

  const stepOutputs: Record<number, any> = context.stepOutputs || {};
  let finalOutput: any = null;

  try {
    // Fetch workflow with steps
    const { data: workflow, error: workflowError } = await supabase
      .from('workflows')
      .select('*, workflow_steps(*)')
      .eq('id', workflow_id)
      .single();

    if (workflowError || !workflow) {
      throw new Error(`Workflow not found: ${workflow_id}`);
    }

    const steps: WorkflowStep[] = workflow.workflow_steps.sort(
      (a: any, b: any) => a.step_number - b.step_number
    );

    console.log(`[Executor] Starting workflow ${workflow_id} (${steps.length} steps)`);

    // Execute each step
    for (const step of steps) {
      try {
        console.log(`[Executor] Step ${step.step_number}: ${step.tool_slug}`);

        // Resolve variables in arguments
        const resolvedArgs = resolveVariables(
          step.tool_arguments,
          params,
          stepOutputs
        );

        // Execute with retry logic
        let result;
        let lastError;

        for (
          let attempt = 0;
          attempt < (step.max_retries || 3);
          attempt++
        ) {
          try {
            result = await executeMCPTool({
              toolkit: step.toolkit,
              tool_slug: step.tool_slug,
              arguments: resolvedArgs,
              user_id,
              timeout: (step.timeout_seconds || 30) * 1000,
            });
            break;
          } catch (err) {
            lastError = err;
            if (attempt < (step.max_retries || 3) - 1) {
              const delay = Math.pow(2, attempt) * 1000;
              console.log(`[Executor] Retry ${attempt + 1} after ${delay}ms`);
              await sleep(delay);
            }
          }
        }

        if (lastError && !result) {
          throw lastError;
        }

        // Store step output
        stepOutputs[step.step_number] = result;
        finalOutput = result;

        console.log(`[Executor] Step ${step.step_number} completed`);
      } catch (err) {
        console.error(`[Executor] Step ${step.step_number} failed:`, err);
        throw err;
      }
    }

    return finalOutput;
  } catch (err) {
    console.error(`[Executor] Workflow failed:`, err);
    throw err;
  }
}

export { ExecutionContext, WorkflowStep };
