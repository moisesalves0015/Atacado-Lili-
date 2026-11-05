import React, { useMemo, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, Filter, Phone, Search, Users, X } from "lucide-react";
import { formatPhoneDisplay, normalizePhone, type ParsedContact } from "../../../shared/vcf";

export interface ExistingClientSimple {
  id: number;
  name: string;
  phone: string;
  phoneNormalized: string;
}

export interface ClientImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawContacts: ParsedContact[];
  existingClients: ExistingClientSimple[];
  sourceTitle: string;
  onImportBatch: (
    contacts: Array<{
      name: string;
      phone: string;
      notes?: string;
      source?: "vcf_import" | "device_contact" | "manual";
    }>,
    source: "vcf_import" | "device_contact" | "manual"
  ) => Promise<{ imported: number; duplicates: number; invalid: number }>;
  onSuccess: (result: { imported: number; duplicates: number; invalid: number }) => void;
}

export function ClientImportModal({
  isOpen,
  onClose,
  rawContacts,
  existingClients,
  sourceTitle,
  onImportBatch,
  onSuccess,
}: ClientImportModalProps) {
  if (!isOpen) return null;

  // Mapa de telefones e nomes existentes para detecção de colisões
  const existingPhoneMap = useMemo(() => {
    const map = new Map<string, ExistingClientSimple>();
    for (const c of existingClients) {
      if (c.phoneNormalized && !c.phoneNormalized.startsWith("sem-contato-")) {
        map.set(c.phoneNormalized, c);
      }
    }
    return map;
  }, [existingClients]);

  const existingNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const c of existingClients) {
      if (c.name) set.add(c.name.trim().toLowerCase());
    }
    return set;
  }, [existingClients]);

  // Estrutura interna com estado editável por linha (telefone selecionado, nome ajustado, seleção)
  const [items, setItems] = useState(() => {
    const seenPhonesInBatch = new Set<string>();

    return rawContacts.map((contact, index) => {
      const activePhone = contact.phone || contact.phones[0] || "";
      const norm = normalizePhone(activePhone);
      const isExistingPhone = Boolean(norm && existingPhoneMap.has(norm));
      const isDuplicateInBatch = Boolean(norm && seenPhonesInBatch.has(norm));
      if (norm) seenPhonesInBatch.add(norm);

      const isExistingName = Boolean(!norm && existingNameSet.has(contact.name.trim().toLowerCase()));
      const isDuplicate = isExistingPhone || isDuplicateInBatch || isExistingName;

      let duplicateReason = "";
      if (isExistingPhone) {
        const match = existingPhoneMap.get(norm);
        duplicateReason = `Telefone já cadastrado (${match?.name || "cliente existente"})`;
      } else if (isDuplicateInBatch) {
        duplicateReason = "Número repetido no mesmo arquivo/seleção";
      } else if (isExistingName) {
        duplicateReason = "Já existe cliente com este nome exato";
      }

      return {
        id: contact.id || `item-${index}`,
        originalContact: contact,
        name: contact.name,
        selectedPhone: activePhone,
        phones: contact.phones.length ? contact.phones : activePhone ? [activePhone] : [],
        notes: contact.notes || "",
        hasValidPhone: contact.hasValidPhone,
        hasValidName: contact.hasValidName,
        isDuplicate,
        duplicateReason,
        // Por padrão: seleciona se não for duplicado
        selected: !isDuplicate && (contact.hasValidName || contact.hasValidPhone),
      };
    });
  });

  const [filter, setFilter] = useState<"all" | "ready" | "duplicates" | "no_phone">("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Estado do progresso de importação em lotes
  const [isImporting, setIsImporting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);

  // Estatísticas do resumo
  const stats = useMemo(() => {
    const total = items.length;
    const duplicates = items.filter(it => it.isDuplicate).length;
    const noPhone = items.filter(it => !it.selectedPhone || it.selectedPhone.replace(/\D/g, "").length < 8).length;
    const ready = items.filter(it => !it.isDuplicate && (it.hasValidName || it.hasValidPhone)).length;
    const selectedCount = items.filter(it => it.selected).length;
    return { total, duplicates, noPhone, ready, selectedCount };
  }, [items]);

  // Lista filtrada para exibição
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter === "ready" && (item.isDuplicate || (!item.hasValidName && !item.hasValidPhone))) {
        return false;
      }
      if (filter === "duplicates" && !item.isDuplicate) {
        return false;
      }
      if (filter === "no_phone" && item.selectedPhone.replace(/\D/g, "").length >= 8) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchPhone = item.selectedPhone.toLowerCase().includes(q);
        return matchName || matchPhone;
      }
      return true;
    });
  }, [items, filter, search]);

  const toggleSelectAll = () => {
    const allSelected = filteredItems.every(it => it.selected);
    const idsToToggle = new Set(filteredItems.map(it => it.id));
    setItems(curr =>
      curr.map(it => (idsToToggle.has(it.id) ? { ...it, selected: !allSelected } : it))
    );
  };

  const toggleItem = (id: string) => {
    setItems(curr =>
      curr.map(it => (it.id === id ? { ...it, selected: !it.selected } : it))
    );
  };

  const changePhone = (id: string, newPhone: string) => {
    setItems(curr =>
      curr.map(it => {
        if (it.id !== id) return it;
        const norm = normalizePhone(newPhone);
        const isExistingPhone = Boolean(norm && existingPhoneMap.has(norm));
        return {
          ...it,
          selectedPhone: newPhone,
          isDuplicate: isExistingPhone,
          duplicateReason: isExistingPhone
            ? `Telefone já cadastrado (${existingPhoneMap.get(norm)?.name || "cliente existente"})`
            : "",
        };
      })
    );
  };

  const startEditName = (item: (typeof items)[0]) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };

  const saveEditName = (id: string) => {
    if (editingName.trim()) {
      setItems(curr =>
        curr.map(it => (it.id === id ? { ...it, name: editingName.trim(), hasValidName: true } : it))
      );
    }
    setEditingId(null);
  };

  // Executa a importação dividida em blocos (chunks de 50 a 100) para evitar timeouts
  const handleConfirmImport = async () => {
    const toImport = items
      .filter(it => it.selected)
      .map(it => ({
        name: it.name.trim() || `Cliente ${it.selectedPhone}`,
        phone: it.selectedPhone.trim(),
        notes: it.notes.trim() || undefined,
        source: (it.originalContact.source || "vcf_import") as "vcf_import" | "device_contact" | "manual",
      }));

    if (toImport.length === 0) return;

    setIsImporting(true);
    const CHUNK_SIZE = 60;
    const totalChunks = Math.ceil(toImport.length / CHUNK_SIZE);
    let totalImported = 0;
    let totalDuplicates = 0;
    let totalInvalid = 0;

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, toImport.length);
        const chunk = toImport.slice(start, end);

        setProgressText(`Importando ${end} de ${toImport.length} clientes...`);
        setProgressPercent(Math.round(((i + 1) / totalChunks) * 100));

        const res = await onImportBatch(
          chunk,
          (chunk[0]?.source as any) || "vcf_import"
        );
        totalImported += res.imported;
        totalDuplicates += res.duplicates;
        totalInvalid += res.invalid;
      }

      onSuccess({
        imported: totalImported,
        duplicates: totalDuplicates,
        invalid: totalInvalid,
      });
      onClose();
    } catch (err: any) {
      alert(`Erro durante a importação: ${err?.message || "Tente novamente."}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !isImporting) onClose(); }}>
      <div className="modal-card" style={{ width: "min(720px, 98vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        {/* Cabeçalho */}
        <div className="modal-head" style={{ marginBottom: "14px" }}>
          <div>
            <div className="eyebrow">importação de contatos · {sourceTitle}</div>
            <h3>Revisar e confirmar contatos</h3>
          </div>
          {!isImporting && (
            <button onClick={onClose} title="Fechar">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Aviso de Privacidade e Conformidade */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "10px",
            background: "#f0f7f6",
            border: "1px solid #cde3dd",
            fontSize: "12px",
            color: "#184547",
            marginBottom: "14px",
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: "2px", color: "var(--teal)" }} />
          <div>
            <strong>Armazenamento no Atacado Lili:</strong> Os contatos confirmados serão salvos na sua lista
            existente de clientes para vendas, cobranças e relatórios. Não há disparo automático de mensagens.
          </div>
        </div>

        {/* Resumo / Estatísticas Rápidas */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "8px",
            marginBottom: "14px",
          }}
        >
          <div style={{ padding: "10px", borderRadius: "10px", background: "#f8f9fa", border: "1px solid #e9ecef" }}>
            <span style={{ fontSize: "11px", color: "#6c757d", display: "block" }}>Total encontrados</span>
            <strong style={{ fontSize: "18px", color: "#212529" }}>{stats.total}</strong>
          </div>
          <div style={{ padding: "10px", borderRadius: "10px", background: "#eef7f3", border: "1px solid #cde3dd" }}>
            <span style={{ fontSize: "11px", color: "#1b4d3e", display: "block" }}>Aptos / Novos</span>
            <strong style={{ fontSize: "18px", color: "#198754" }}>{stats.ready}</strong>
          </div>
          <div style={{ padding: "10px", borderRadius: "10px", background: "#fff8ec", border: "1px solid #f6deb3" }}>
            <span style={{ fontSize: "11px", color: "#856404", display: "block" }}>Já cadastrados</span>
            <strong style={{ fontSize: "18px", color: "#b8860b" }}>{stats.duplicates}</strong>
          </div>
          <div style={{ padding: "10px", borderRadius: "10px", background: "#fdf3f0", border: "1px solid #fad2c8" }}>
            <span style={{ fontSize: "11px", color: "#721c24", display: "block" }}>Sem telefone</span>
            <strong style={{ fontSize: "18px", color: "#dc3545" }}>{stats.noPhone}</strong>
          </div>
        </div>

        {/* Barra de Filtros e Busca */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <button
              type="button"
              onClick={() => setFilter("all")}
              style={{
                padding: "5px 10px",
                borderRadius: "20px",
                fontSize: "11px",
                border: filter === "all" ? "1px solid var(--teal)" : "1px solid #ddd",
                background: filter === "all" ? "var(--teal)" : "#fff",
                color: filter === "all" ? "#fff" : "#444",
                cursor: "pointer",
              }}
            >
              Todos ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setFilter("ready")}
              style={{
                padding: "5px 10px",
                borderRadius: "20px",
                fontSize: "11px",
                border: filter === "ready" ? "1px solid #198754" : "1px solid #ddd",
                background: filter === "ready" ? "#198754" : "#fff",
                color: filter === "ready" ? "#fff" : "#444",
                cursor: "pointer",
              }}
            >
              Aptos / Novos ({stats.ready})
            </button>
            <button
              type="button"
              onClick={() => setFilter("duplicates")}
              style={{
                padding: "5px 10px",
                borderRadius: "20px",
                fontSize: "11px",
                border: filter === "duplicates" ? "1px solid #b8860b" : "1px solid #ddd",
                background: filter === "duplicates" ? "#b8860b" : "#fff",
                color: filter === "duplicates" ? "#fff" : "#444",
                cursor: "pointer",
              }}
            >
              Já cadastrados ({stats.duplicates})
            </button>
            <button
              type="button"
              onClick={() => setFilter("no_phone")}
              style={{
                padding: "5px 10px",
                borderRadius: "20px",
                fontSize: "11px",
                border: filter === "no_phone" ? "1px solid #6c757d" : "1px solid #ddd",
                background: filter === "no_phone" ? "#6c757d" : "#fff",
                color: filter === "no_phone" ? "#fff" : "#444",
                cursor: "pointer",
              }}
            >
              Sem telefone ({stats.noPhone})
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 200px", maxWidth: "260px" }}>
            <div style={{ position: "relative", width: "100%" }}>
              <input
                type="text"
                placeholder="Filtrar nesta prévia..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 10px 6px 28px",
                  fontSize: "11px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                }}
              />
              <Search size={14} style={{ position: "absolute", left: "8px", top: "8px", color: "#888" }} />
            </div>
          </div>
        </div>

        {/* Seleção em massa */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            background: "#f8f9fa",
            borderRadius: "6px",
            fontSize: "11px",
            marginBottom: "8px",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={filteredItems.length > 0 && filteredItems.every(it => it.selected)}
              onChange={toggleSelectAll}
            />
            <span>
              Marcar todos visíveis ({filteredItems.filter(it => it.selected).length} de {filteredItems.length} selecionados)
            </span>
          </label>
          <span style={{ color: "#666" }}>Total geral marcado: <strong>{stats.selectedCount}</strong></span>
        </div>

        {/* Lista com rolagem de contatos */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            maxHeight: "360px",
            border: "1px solid var(--line)",
            borderRadius: "10px",
            background: "#fff",
          }}
        >
          {filteredItems.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#888", fontSize: "12px" }}>
              Nenhum contato encontrado com este filtro.
            </div>
          ) : (
            filteredItems.map(item => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  padding: "10px 12px",
                  borderBottom: "1px solid #edf1ef",
                  background: item.selected ? "#fff" : "#fafafa",
                  opacity: item.selected ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleItem(item.id)}
                    style={{ cursor: "pointer", width: "16px", height: "16px" }}
                  />

                  <div style={{ minWidth: 0, flex: 1 }}>
                    {/* Nome com suporte a edição rápida */}
                    {editingId === item.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveEditName(item.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          style={{ fontSize: "12px", padding: "3px 6px", borderRadius: "5px", border: "1px solid var(--teal)" }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => saveEditName(item.id)}
                          style={{ padding: "3px 8px", fontSize: "10px", background: "var(--teal)", color: "#fff", border: 0, borderRadius: "5px" }}
                        >
                          OK
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <strong
                          style={{
                            fontSize: "12px",
                            color: item.isDuplicate ? "#7a5c0b" : "var(--teal-deep)",
                            cursor: "pointer",
                          }}
                          onClick={() => startEditName(item)}
                          title="Clique para editar o nome"
                        >
                          {item.name || "(Sem nome)"}
                        </strong>
                        {!item.hasValidName && (
                          <span style={{ fontSize: "9px", background: "#f1f3f5", color: "#666", padding: "1px 5px", borderRadius: "4px" }}>
                            Nome gerado
                          </span>
                        )}
                      </div>
                    )}

                    {/* Telefone e seletor quando houver múltiplos números */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px", fontSize: "11px" }}>
                      {item.phones.length > 1 ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ color: "#666", fontSize: "10px" }}>Número principal:</span>
                          <select
                            value={item.selectedPhone}
                            onChange={e => changePhone(item.id, e.target.value)}
                            style={{
                              fontSize: "11px",
                              padding: "2px 6px",
                              borderRadius: "6px",
                              border: "1px solid #ced4da",
                              background: "#fdfefe",
                              maxWidth: "180px",
                            }}
                          >
                            {item.phones.map((p, pIdx) => (
                              <option key={pIdx} value={p}>
                                {formatPhoneDisplay(p)} {pIdx === 0 ? "★" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span style={{ color: item.selectedPhone ? "#495057" : "#dc3545" }}>
                          {item.selectedPhone ? formatPhoneDisplay(item.selectedPhone) : "Sem telefone"}
                        </span>
                      )}

                      {item.notes && (
                        <span style={{ color: "#888", fontSize: "10px", fontStyle: "italic", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          · {item.notes}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status Badges */}
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  {item.isDuplicate ? (
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "3px 8px",
                        borderRadius: "12px",
                        background: "#fff3cd",
                        color: "#856404",
                        border: "1px solid #ffeeba",
                        display: "inline-block",
                      }}
                      title={item.duplicateReason}
                    >
                      Já cadastrado
                    </span>
                  ) : !item.hasValidPhone ? (
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "3px 8px",
                        borderRadius: "12px",
                        background: "#e2e3e5",
                        color: "#383d41",
                        display: "inline-block",
                      }}
                    >
                      Sem telefone
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "3px 8px",
                        borderRadius: "12px",
                        background: "#d1e7dd",
                        color: "#0f5132",
                        display: "inline-block",
                      }}
                    >
                      Novo
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Barra de Progresso quando estiver importando */}
        {isImporting && (
          <div style={{ marginTop: "14px", padding: "12px", background: "#f8f9fa", borderRadius: "10px", border: "1px solid #e9ecef" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "6px", color: "var(--teal)" }}>
              <strong>{progressText}</strong>
              <span>{progressPercent}%</span>
            </div>
            <div style={{ height: "8px", background: "#e9ecef", borderRadius: "4px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progressPercent}%`,
                  background: "var(--teal)",
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Rodapé e Ações */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={stats.selectedCount === 0 || isImporting}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "9px 20px",
              borderRadius: "8px",
              border: 0,
              background: stats.selectedCount > 0 ? "var(--teal)" : "#bbb",
              color: "#fff",
              fontWeight: 700,
              fontSize: "13px",
              cursor: stats.selectedCount > 0 ? "pointer" : "not-allowed",
            }}
          >
            <Check size={16} />
            {isImporting
              ? "Processando importação..."
              : `Importar ${stats.selectedCount} ${stats.selectedCount === 1 ? "cliente" : "clientes"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
