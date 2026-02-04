import type { JulesClient } from '@google/jules-sdk';
import type { InteractResult, InteractAction } from './types.js';

export async function interact(
  client: JulesClient,
  sessionId: string,
  action: InteractAction,
  message?: string,
): Promise<InteractResult> {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }

  const session = client.session(sessionId);

  if (action === 'approve') {
    await session.approve();
    return { success: true, message: 'Plan approved.' };
  }

  if (action === 'send') {
    if (!message) {
      throw new Error("Message is required for 'send' action");
    }
    await session.send(message);
    return { success: true, message: 'Message sent.' };
  }

  if (action === 'ask') {
    if (!message) {
      throw new Error("Message is required for 'ask' action");
    }
    const reply = await session.ask(message);
    return { success: true, reply: reply.message };
  }

  throw new Error(`Invalid action: ${action}`);
}
