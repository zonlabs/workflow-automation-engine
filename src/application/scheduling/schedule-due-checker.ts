import { CronExpressionParser } from "cron-parser";

export const DEFAULT_WORKFLOW_TIMEZONE = "Asia/Kolkata";

export function isScheduleDue(
  cronExpression: string,
  lastCheckedAt: Date,
  now: Date,
  timezone = DEFAULT_WORKFLOW_TIMEZONE
): boolean {
  try {
    const expr = CronExpressionParser.parse(cronExpression, {
      currentDate: lastCheckedAt,
      tz: timezone,
    });

    return expr.next().toDate() <= now;
  } catch {
    return false;
  }
}
