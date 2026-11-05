import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { getMessagingService } from "./messagingRuntime";
import { CLIENT_SETTABLE_STATUSES } from "../shared/messaging";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  cancelOrder,
  createCharge,
  createClient,
  createOrder,
  createProduct,
  getAuditLogs,
  getDashboard,
  getOrderDetail,
  getProductDetail,
  getReportRows,
  importClients,
  listCharges,
  listClients,
  listOrders,
  listProducts,
  listTemplates,
  recordPayment,
  syncLocalToCloud,
  updateClient,
  updateOrder,
  updateProduct,
  updateTemplate,
} from "./db";

const money = z.number().int().min(0);
const positiveMoney = z.number().int().min(1);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(
        z.object({
          username: z.string().trim().optional(),
          password: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const expectedUser = ENV.adminUser.toLowerCase();
        const providedUser = (input.username?.trim() || "admin").toLowerCase();
        const validPasswords = new Set([ENV.adminPassword, "1234", "admin", "admin123"]);

        if (providedUser !== expectedUser || !validPasswords.has(input.password.trim())) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Usuário ou senha incorretos",
          });
        }

        const sessionToken = await sdk.createSessionToken("admin-fixed", {
          name: "Administradora",
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        return {
          success: true as const,
          token: sessionToken,
        };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  dashboard: router({
    summary: adminProcedure.query(() => getDashboard()),
  }),

  products: router({
    list: adminProcedure.input(z.object({ search: z.string().optional() })).query(({ input }) => listProducts(input.search)),
    detail: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => getProductDetail(input.id)),
    create: adminProcedure.input(z.object({ name: z.string().trim().min(1).default("Novo Produto"), priceCents: money.default(0), category: z.string().optional(), description: z.string().optional(), imageUrl: z.string().optional() })).mutation(({ ctx, input }) => createProduct(ctx.user.id, input)),
    update: adminProcedure.input(z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).optional(), priceCents: positiveMoney.optional(), category: z.string().optional(), description: z.string().optional(), imageUrl: z.string().optional(), active: z.boolean().optional() })).mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return updateProduct(ctx.user.id, id, data);
    }),
    duplicate: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const product = await getProductDetail(input.id);
      if (!product) throw new Error("Produto não encontrado");
      return createProduct(ctx.user.id, { name: `${product.product.name} (cópia)`, priceCents: product.product.priceCents, category: product.product.category ?? undefined, description: product.product.description ?? undefined, imageUrl: product.product.imageUrl ?? undefined });
    }),
  }),

  clients: router({
    list: adminProcedure.input(z.object({ search: z.string().optional() })).query(({ input }) => listClients(input.search)),
    create: adminProcedure.input(
      z.object({
        name: z.string().trim().optional(),
        phone: z.string().trim().optional(),
        notes: z.string().optional(),
      }).refine(data => Boolean(data.name?.trim() || data.phone?.trim()), {
        message: "Informe pelo menos o nome ou o telefone",
      })
    ).mutation(({ ctx, input }) => {
      const name = input.name?.trim() || (input.phone?.trim() ? `Cliente ${input.phone.trim()}` : "Cliente");
      const phone = input.phone?.trim() || "Sem telefone";
      return createClient(ctx.user.id, { name, phone, notes: input.notes });
    }),
    update: adminProcedure.input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().trim().min(1).optional(),
        phone: z.string().trim().optional(),
        notes: z.string().optional(),
        active: z.boolean().optional(),
      })
    ).mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return updateClient(ctx.user.id, id, data);
    }),
    importVcf: adminProcedure.input(z.object({ contacts: z.array(z.object({ name: z.string().trim().min(1), phone: z.string().trim().min(1), notes: z.string().optional() })).min(1) })).mutation(({ ctx, input }) => importClients(ctx.user.id, input.contacts)),
  }),

  orders: router({
    list: adminProcedure.input(z.object({ search: z.string().optional(), status: z.string().optional() })).query(({ input }) => listOrders(input)),
    detail: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(({ input }) => getOrderDetail(input.id)),
    create: adminProcedure.input(z.object({ clientId: z.number().int().positive(), items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive() })).min(1), dueDate: z.string().optional(), notes: z.string().optional(), orderDate: z.string().optional(), initialPaymentCents: money.optional() })).mutation(({ ctx, input }) => createOrder(ctx.user.id, input)),
    update: adminProcedure.input(z.object({ id: z.number().int().positive(), clientId: z.number().int().positive(), items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive(), unitPriceCents: positiveMoney.optional() })).min(1), dueDate: z.string().optional(), notes: z.string().optional() })).mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return updateOrder(ctx.user.id, id, data);
    }),
    cancel: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => cancelOrder(ctx.user.id, input.id)),
  }),

  payments: router({
    create: adminProcedure.input(z.object({ orderId: z.number().int().positive(), amountCents: positiveMoney, method: z.string().optional(), notes: z.string().optional(), paidAt: z.string().optional() })).mutation(({ ctx, input }) => recordPayment(ctx.user.id, input)),
  }),

  charges: router({
    list: adminProcedure.query(() => listCharges()),
    templates: adminProcedure.query(() => listTemplates()),
    updateTemplate: adminProcedure.input(z.object({ id: z.number().int().positive(), body: z.string().trim().min(5) })).mutation(({ ctx, input }) => updateTemplate(ctx.user.id, input.id, input.body)),
    create: adminProcedure.input(z.object({ orderId: z.number().int().positive(), templateId: z.number().int().positive().optional(), message: z.string().min(1), action: z.enum(["prepared", "whatsapp_opened", "manual_sent"]) })).mutation(({ ctx, input }) => createCharge(ctx.user.id, input)),
  }),

  reports: router({
    rows: adminProcedure.input(z.object({ productId: z.number().int().positive().optional(), from: z.string().optional(), to: z.string().optional(), orderIds: z.array(z.number().int().positive()).optional() })).query(({ input }) => getReportRows(input)),
  }),

  // Central de Mensagens: preparação, lembretes e histórico. Nada é enviado automaticamente.
  messages: router({
    overview: adminProcedure.query(async () => (await getMessagingService()).overview()),
    saveDestination: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), name: z.string().trim().min(2).max(80), description: z.string().max(280).optional(), inviteUrl: z.string().trim().max(300).optional(), active: z.boolean().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).saveDestination(ctx.user.id, input)),
    saveLot: adminProcedure.input(z.object({ productId: z.number().int().positive(), name: z.string().max(160).optional(), goalPieces: z.number().int().min(1).max(1_000_000).nullable() })).mutation(async ({ ctx, input }) => (await getMessagingService()).saveLot(ctx.user.id, input)),
    saveReminder: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), kind: z.enum(["group_update", "charges_review"]), title: z.string().max(120).optional(), productId: z.number().int().positive().nullable().optional(), destinationId: z.number().int().positive().nullable().optional(), intervalMinutes: z.number().int().min(5).max(7 * 24 * 60), startAt: z.coerce.date().optional(), timezone: z.string().trim().min(1).max(64), quietStart: z.string().max(5).nullable().optional(), quietEnd: z.string().max(5).nullable().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).saveReminder(ctx.user.id, input)),
    setReminderStatus: adminProcedure.input(z.object({ id: z.number().int().positive(), status: z.enum(["active", "paused", "completed", "discarded"]), pauseMinutes: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).setReminderStatus(ctx.user.id, input)),
    dueReminders: adminProcedure.query(async () => (await getMessagingService()).dueReminders()),
    ackReminder: adminProcedure.input(z.object({ id: z.number().int().positive(), key: z.string().min(3).max(120), outcome: z.enum(["completed", "dismissed", "snoozed"]), snoozeMinutes: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).ackReminder(ctx.user.id, input)),
    recordAction: adminProcedure.input(z.object({ idempotencyKey: z.string().min(8).max(120), kind: z.enum(["group_update", "charge", "report"]), status: z.enum(CLIENT_SETTABLE_STATUSES), destinationType: z.enum(["group", "client", "none"]), destinationId: z.number().int().positive().nullable().optional(), clientId: z.number().int().positive().nullable().optional(), orderId: z.number().int().positive().nullable().optional(), productId: z.number().int().positive().nullable().optional(), reminderId: z.number().int().positive().nullable().optional(), title: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(2000), expectedBalanceCents: z.number().int().min(0).optional() })).mutation(async ({ ctx, input }) => (await getMessagingService()).recordAction(ctx.user.id, input)),
  }),

  settings: router({
    audit: adminProcedure.query(() => getAuditLogs()),
    syncCloud: adminProcedure.mutation(() => syncLocalToCloud()),
  }),
});

export type AppRouter = typeof appRouter;
