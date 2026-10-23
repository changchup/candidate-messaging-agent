import { z } from 'zod';
import { DraftSchema } from '../domain/schemas.ts';
import {
  GetCandidateInput,
  GetJobInput,
  type createGetCandidate,
  type createGetJob,
} from '../tools/candidate-tools.ts';
import { GetInterviewSlotsInput, type createGetInterviewSlots } from '../tools/slot-tools.ts';
import { err, type ToolResult } from '../tools/result.ts';
import type { ToolSpec } from './llm/types.ts';

export interface DataTools {
  getCandidate: ReturnType<typeof createGetCandidate>;
  getJob: ReturnType<typeof createGetJob>;
  getInterviewSlots: ReturnType<typeof createGetInterviewSlots>;
}

export const CannotDraftInput = z.object({ reason: z.string().min(1).max(500) });

const toJson = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;

/** Tools the model may call. `send_message` is intentionally absent. */
export const AGENT_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'get_candidate',
    description:
      'Fetch the candidate profile from the ATS. Includes a `stale` flag if the profile is outdated.',
    inputSchema: toJson(GetCandidateInput),
  },
  {
    name: 'get_job',
    description: 'Fetch the job the candidate applied for.',
    inputSchema: toJson(GetJobInput),
  },
  {
    name: 'get_interview_slots',
    description:
      "List open future interview slots for a job. Pass the candidate's IANA timezone to get localised times.",
    inputSchema: toJson(GetInterviewSlotsInput),
  },
  {
    name: 'submit_draft',
    description:
      'Submit the finished interview invitation for automated checks and human review. Only use slot ids returned by get_interview_slots. citedFacts lists the tool facts the message relies on.',
    inputSchema: toJson(DraftSchema),
  },
  {
    name: 'cannot_draft',
    description:
      'Stop and explain why a safe, accurate invitation cannot be drafted (e.g. no slots, data unavailable, unsafe request).',
    inputSchema: toJson(CannotDraftInput),
  },
];

/**
 * Data tools bound to a single run. The model can only read the candidate and job the
 * recruiter selected (least privilege; blunts prompt injection asking for other records).
 */
export function scopedDataTools(tools: DataTools, scope: { candidateId: string; jobId: string }) {
  return async (name: string, rawInput: unknown): Promise<ToolResult<unknown>> => {
    switch (name) {
      case 'get_candidate': {
        const input = GetCandidateInput.safeParse(rawInput);
        if (!input.success) return err('INVALID_INPUT', z.prettifyError(input.error));
        if (input.data.candidateId !== scope.candidateId) {
          return err('INVALID_INPUT', `This run may only access candidate ${scope.candidateId}.`);
        }
        return tools.getCandidate(input.data);
      }
      case 'get_job': {
        const input = GetJobInput.safeParse(rawInput);
        if (!input.success) return err('INVALID_INPUT', z.prettifyError(input.error));
        if (input.data.jobId !== scope.jobId) {
          return err('INVALID_INPUT', `This run may only access job ${scope.jobId}.`);
        }
        return tools.getJob(input.data);
      }
      case 'get_interview_slots': {
        const input = GetInterviewSlotsInput.safeParse(rawInput);
        if (!input.success) return err('INVALID_INPUT', z.prettifyError(input.error));
        if (input.data.jobId !== scope.jobId) {
          return err('INVALID_INPUT', `This run may only access job ${scope.jobId}.`);
        }
        return tools.getInterviewSlots(input.data);
      }
      default:
        return err('INVALID_INPUT', `Unknown tool ${name}`);
    }
  };
}
