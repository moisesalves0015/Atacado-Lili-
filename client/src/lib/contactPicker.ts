import { formatDeviceContacts, type ParsedContact } from "../../../shared/vcf";

export interface ContactPickerSupport {
  supported: boolean;
  reason?: string;
}

/**
 * Detecta se a Web Contact Picker API está disponível no navegador e dispositivo.
 */
export function checkContactPickerSupport(): ContactPickerSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { supported: false, reason: "Ambiente não suporta navegador web." };
  }

  const hasNavigatorContacts = "contacts" in navigator && typeof (navigator as any).contacts?.select === "function";
  const hasContactsManager = "ContactsManager" in window;

  if (!hasNavigatorContacts && !hasContactsManager) {
    return {
      supported: false,
      reason:
        "Este navegador não possui suporte ao seletor nativo de contatos. Em computadores ou navegadores que não suportam, recomendamos a opção 'Importar VCF'.",
    };
  }

  return { supported: true };
}

export function isContactPickerSupported(): boolean {
  return checkContactPickerSupport().supported;
}

/**
 * Abre o seletor nativo de contatos do aparelho após clique explícito do usuário.
 * Solicita apenas as propriedades necessárias: 'name' e 'tel'.
 */
export async function openDeviceContactPicker(): Promise<ParsedContact[]> {
  const support = checkContactPickerSupport();
  if (!support.supported) {
    throw new Error(support.reason || "Seletor de contatos não disponível neste navegador.");
  }

  try {
    const contactsManager = (navigator as any).contacts;
    let propsToRequest = ["name", "tel"];

    // Se suportar getProperties, verifica se nome e telefone são suportados
    if (typeof contactsManager.getProperties === "function") {
      try {
        const availableProps: string[] = await contactsManager.getProperties();
        propsToRequest = propsToRequest.filter(p => availableProps.includes(p));
        if (propsToRequest.length === 0) {
          throw new Error("O navegador não suporta leitura de nome ou telefone pela agenda.");
        }
      } catch {
        // Fallback para props padrão
      }
    }

    const selected = await contactsManager.select(propsToRequest, { multiple: true });

    if (!selected || !Array.isArray(selected) || selected.length === 0) {
      return [];
    }

    return formatDeviceContacts(selected);
  } catch (err: any) {
    // Se o usuário cancelou o seletor, retorna array vazio sem levantar erro
    if (
      err?.name === "AbortError" ||
      err?.code === 20 ||
      err?.message?.toLowerCase().includes("cancel") ||
      err?.message?.toLowerCase().includes("user closed")
    ) {
      return [];
    }

    if (err?.name === "SecurityError" || err?.name === "NotAllowedError") {
      throw new Error(
        "Permissão negada para acessar os contatos do aparelho. Você pode exportar seus contatos para um arquivo .VCF e importá-los facilmente."
      );
    }

    throw err;
  }
}

