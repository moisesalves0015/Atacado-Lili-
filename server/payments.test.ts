import { describe, expect, it } from "vitest";
import {
  createClient,
  createOrder,
  createProduct,
  deletePayment,
  getOrderDetail,
  recordPayment,
  resetOrderPayments,
  updateOrder,
} from "./db";

function randomPhone() {
  return `659${Math.floor(10000000 + Math.random() * 89999999)}`;
}

describe("Gestão e reversão de pagamentos de pedidos", () => {
  it("permite registrar pagamento, depois excluir o pagamento e voltar a Pendente", async () => {
    const actorId = 1;
    const client = await createClient(actorId, { name: "Cliente Teste Pagamento", phone: randomPhone() });
    const product = await createProduct(actorId, { name: "Vestido Teste", priceCents: 5000 });

    const orderRes = await createOrder(actorId, {
      clientId: client.id,
      items: [{ productId: product.id, quantity: 2 }], // total 10000 (R$ 100,00)
    });

    const initialOrder = await getOrderDetail(orderRes.id);
    expect(initialOrder?.paidCents).toBe(0);
    expect(initialOrder?.status).toBe("pending");

    // Registra pagamento integral (R$ 100,00)
    await recordPayment(actorId, {
      orderId: orderRes.id,
      amountCents: 10000,
      method: "Pix",
    });

    const paidOrder = await getOrderDetail(orderRes.id);
    expect(paidOrder?.paidCents).toBe(10000);
    expect(paidOrder?.status).toBe("paid");
    expect(paidOrder?.payments.length).toBe(1);

    const paymentId = paidOrder!.payments[0].id;

    // Exclui o pagamento registrado por engano
    const deleteRes = await deletePayment(actorId, paymentId);
    expect(deleteRes.ok).toBe(true);
    expect(deleteRes.paidCents).toBe(0);
    expect(deleteRes.status).toBe("pending");

    const revertedOrder = await getOrderDetail(orderRes.id);
    expect(revertedOrder?.paidCents).toBe(0);
    expect(revertedOrder?.status).toBe("pending");
    expect(revertedOrder?.payments.length).toBe(0);
  });

  it("permite resetar todos os pagamentos de um pedido em lote (resetOrderPayments)", async () => {
    const actorId = 1;
    const client = await createClient(actorId, { name: "Cliente Teste Reset", phone: randomPhone() });
    const product = await createProduct(actorId, { name: "Blusa Teste", priceCents: 3000 });

    const orderRes = await createOrder(actorId, {
      clientId: client.id,
      items: [{ productId: product.id, quantity: 1 }],
      initialPaymentCents: 3000, // Criado já como pago
    });

    const paidOrder = await getOrderDetail(orderRes.id);
    expect(paidOrder?.status).toBe("paid");
    expect(paidOrder?.paidCents).toBe(3000);

    // Reseta todos os pagamentos do pedido
    const resetRes = await resetOrderPayments(actorId, orderRes.id);
    expect(resetRes.ok).toBe(true);
    expect(resetRes.paidCents).toBe(0);
    expect(resetRes.status).toBe("pending");

    const pendingOrder = await getOrderDetail(orderRes.id);
    expect(pendingOrder?.status).toBe("pending");
    expect(pendingOrder?.paidCents).toBe(0);
  });

  it("permite editar itens do pedido após desmarcar o pagamento", async () => {
    const actorId = 1;
    const client = await createClient(actorId, { name: "Cliente Edicao", phone: randomPhone() });
    const product = await createProduct(actorId, { name: "Calça Teste", priceCents: 4000 });

    const orderRes = await createOrder(actorId, {
      clientId: client.id,
      items: [{ productId: product.id, quantity: 2 }], // 8000
      initialPaymentCents: 8000,
    });

    // Edita o pedido passando resetPayment: true e diminuindo a quantidade de 2 para 1
    const updateRes = await updateOrder(actorId, orderRes.id, {
      clientId: client.id,
      items: [{ productId: product.id, quantity: 1 }], // total agora é 4000
      resetPayment: true,
    });

    expect(updateRes.ok).toBe(true);
    expect(updateRes.totalCents).toBe(4000);
    expect(updateRes.status).toBe("pending");

    const updated = await getOrderDetail(orderRes.id);
    expect(updated?.paidCents).toBe(0);
    expect(updated?.totalCents).toBe(4000);
    expect(updated?.status).toBe("pending");
  });
});
