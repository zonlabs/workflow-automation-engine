import { MANUAL_SCHEDULE_NAME } from "../domain/schedule-constants";
import { ScheduleRepository } from "../infrastructure/supabase/schedule-repository";

export { MANUAL_SCHEDULE_NAME };

const scheduleRepository = new ScheduleRepository();

export async function ensureManualSchedule(userId: string, workflowId: string): Promise<string> {
  return scheduleRepository.ensureManualSchedule(userId, workflowId);
}
