import supabase from './supabase';
import redisClient from './redis';

interface MCPCredentials {
  toolkit: string;
  token?: string;
  api_key?: string;
  [key: string]: any;
}

interface ExecuteOptions {
  toolkit: string;
  tool_slug: string;
  arguments: Record<string, any>;
  user_id: string;
  timeout?: number;
}

// Helper: decrypt credentials (implement your own encryption)
function decryptCredential(encrypted: any): MCPCredentials {
  // TODO: Implement proper decryption
  return encrypted;
}

// Get credentials from Redis cache or Supabase
async function getCredentials(
  user_id: string,
  toolkit: string
): Promise<MCPCredentials> {
  const redisKey = `${process.env.MCP_CREDENTIALS_REDIS_PREFIX}${user_id}:${toolkit}`;

  try {
    // Try Redis cache first
    const cached = await redisClient.get(redisKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn(`[MCP] Redis cache miss for ${toolkit}`, err);
  }

  // Fetch from Supabase
  const { data, error } = await supabase
    .from('mcp_credentials')
    .select('encrypted_credential, credential_name')
    .eq('user_id', user_id)
    .eq('toolkit', toolkit)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error(`No credentials found for ${toolkit}: ${error?.message || 'Unknown'}`);
  }

  // Decrypt
  const decrypted = decryptCredential(data.encrypted_credential);
  const credString = JSON.stringify(decrypted);

  // Cache for 1 hour
  try {
    await redisClient.setex(redisKey, 3600, credString);
  } catch (err) {
    console.warn(`[MCP] Failed to cache credentials`, err);
  }

  return decrypted;
}

// Execute MCP tool
async function executeMCPTool(options: ExecuteOptions): Promise<any> {
  const {
    toolkit,
    tool_slug,
    arguments: args,
    user_id,
    timeout = 30000,
  } = options;

  console.log(`[MCP] Executing ${toolkit}/${tool_slug}`);

  try {
    // Get user's MCP credentials
    const credentials = await getCredentials(user_id, toolkit);

    // Call MCP server
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(
      `${process.env.MCP_SERVER_URL || 'http://localhost:3001'}/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${credentials.token || credentials.api_key || ''}`,
        },
        body: JSON.stringify({
          toolkit,
          tool_slug,
          arguments: args,
        }),
        signal: controller.signal,
      } as any
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MCP execution failed (${response.status}): ${error}`);
    }

    const result = await response.json();
    console.log(`[MCP] ${toolkit}/${tool_slug} completed`);
    return result;
  } catch (err) {
    console.error(`[MCP] Execution failed:`, err);
    throw err;
  }
}

export { executeMCPTool, getCredentials, MCPCredentials };
