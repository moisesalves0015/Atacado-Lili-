import { createCharge, getOrderBalance, recordAudit } from "./db";
import { createMessagingService } from "./messaging";
import { getMessagingRepo } from "./messagingRepos";

/** Serviço real: persistência do ambiente, auditoria e vínculo com o histórico de cobranças existente. */
export async function getMessagingService() {
  return createMessagingService({
    repo: await getMessagingRepo(),
    audit: recordAudit,
    getOrderBalance,
    registerCharge: async (actorUserId, input) => {
      await createCharge(actorUserId, { orderId: input.orderId, message: input.message, action: input.action });
    },
  });
}

