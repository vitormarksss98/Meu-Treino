import { Ionicons } from "@expo/vector-icons";
import { useKeepAwake } from "expo-keep-awake";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BarraDescanso from "../../components/BarraDescanso";
import { cores } from "../../lib/tema";

type Tipo = "normal" | "aq" | "falha" | "drop";
type Serie = {
  carga: string;
  reps: string;
  tipo: Tipo;
  feita: boolean;
  refCarga: string; // marca d'água: valor da última vez
  refReps: string;
};
type Ex = {
  exercicioId: number;
  nome: string;
  nota: string;
  series: Serie[];
  temHistorico: boolean;
  melhorRm: number;
  melhorCarga: number;
};

const AZUL = "#42a5f5";
const ESCURO = "#121212";
const TIPOS: Record<Tipo, { rotulo: string; cor: string; texto: string; proximo: Tipo }> = {
  normal: { rotulo: "Nor", cor: cores.campo, texto: cores.texto, proximo: "aq" },
  aq: { rotulo: "Aq.", cor: AZUL, texto: ESCURO, proximo: "falha" },
  falha: { rotulo: "F", cor: cores.perigo, texto: ESCURO, proximo: "drop" },
  drop: { rotulo: "Drop", cor: cores.aviso, texto: ESCURO, proximo: "normal" },
};

const VALIDADE_RASCUNHO_MS = 12 * 60 * 60 * 1000;

const rmDe = (carga: number, reps: number) => carga * (1 + reps / 30);
const contaParaPR = (t: Tipo) => t === "normal" || t === "falha";

function lerSerie(s: Serie) {
  return {
    c: parseFloat(s.carga.replace(",", ".")),
    r: parseInt(s.reps, 10),
  };
}

// PR: só séries normal/falha, só se já existe histórico, e comparando
// com o histórico + séries anteriores já marcadas hoje no mesmo exercício
function calcularPR(e: Ex, si: number): boolean {
  const s = e.series[si];
  if (!s.feita || !contaParaPR(s.tipo) || !e.temHistorico) return false;
  const { c, r } = lerSerie(s);
  if (isNaN(c) || isNaN(r) || r <= 0) return false;

  let refRm = e.melhorRm;
  let refCarga = e.melhorCarga;
  for (let j = 0; j < si; j++) {
    const o = e.series[j];
    if (!o.feita || !contaParaPR(o.tipo)) continue;
    const { c: oc, r: or } = lerSerie(o);
    if (isNaN(oc) || isNaN(or) || or <= 0) continue;
    refRm = Math.max(refRm, rmDe(oc, or));
    refCarga = Math.max(refCarga, oc);
  }
  return rmDe(c, r) > refRm + 0.05 || c > refCarga + 0.001;
}

export default function Sessao() {
  useKeepAwake();

  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const treinoId = Number(id);

  const [nomeTreino, setNomeTreino] = useState("Treino de hoje");
  const [exs, setExs] = useState<Ex[]>([]);
  const [aberto, setAberto] = useState<number | null>(0);
  const [carregado, setCarregado] = useState(false);
  const [restaurado, setRestaurado] = useState(false);
  const [duracao, setDuracao] = useState(90);
  const [fim, setFim] = useState<number | null>(null);
  const [tecladoAberto, setTecladoAberto] = useState(false);
  const [kbAltura, setKbAltura] = useState(0);
  const [notaEdit, setNotaEdit] = useState<{ ei: number; texto: string } | null>(null);

  const finalizado = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const inputs = useRef<Record<string, TextInput | null>>({});
  const focoAtual = useRef<string | null>(null);
  const kbTopo = useRef(0);

  // ---------- teclado ----------
  function rolarParaFoco() {
    const chave = focoAtual.current;
    if (!chave || kbTopo.current === 0) return;
    inputs.current[chave]?.measureInWindow((_x, y, _w, h) => {
      const limite = kbTopo.current - 40;
      const fundo = y + h;
      if (fundo > limite) {
        scrollRef.current?.scrollTo({
          y: scrollY.current + (fundo - limite),
          animated: true,
        });
      }
    });
  }

  useEffect(() => {
    const mostrar = Keyboard.addListener("keyboardDidShow", (ev) => {
      kbTopo.current = ev.endCoordinates.screenY;
      setKbAltura(ev.endCoordinates.height);
      setTecladoAberto(true);
      setTimeout(rolarParaFoco, 120);
    });
    const esconder = Keyboard.addListener("keyboardDidHide", () => {
      kbTopo.current = 0;
      setKbAltura(0);
      setTecladoAberto(false);
    });
    return () => {
      mostrar.remove();
      esconder.remove();
    };
  }, []);

  // ---------- carregar ----------
  const carregar = useCallback(
    async (usarRascunho: boolean) => {
      const t = await db.getFirstAsync<{ nome: string }>(
        "SELECT nome FROM treinos WHERE id = ?",
        treinoId
      );
      if (t) setNomeTreino(t.nome);

      const base = await db.getAllAsync<{
        exercicio_id: number;
        nome: string;
        nota: string | null;
        planejadas: number;
      }>(
        `SELECT te.exercicio_id, e.nome, e.nota, te.series_planejadas AS planejadas
         FROM treino_exercicios te
         JOIN exercicios e ON e.id = te.exercicio_id
         WHERE te.treino_id = ?
         ORDER BY te.ordem, te.id`,
        treinoId
      );

      let resultado: Ex[] = [];
      for (const b of base) {
        const ultimas = await db.getAllAsync<{ carga: number; reps: number }>(
          `SELECT carga, reps FROM series
           WHERE exercicio_id = ? AND tipo IN ('normal','falha')
             AND sessao_id = (SELECT MAX(sessao_id) FROM series
                              WHERE exercicio_id = ? AND tipo IN ('normal','falha'))
           ORDER BY id`,
          b.exercicio_id,
          b.exercicio_id
        );
        const hist = await db.getFirstAsync<{
          rm: number | null;
          carga: number | null;
          n: number;
        }>(
          `SELECT MAX(carga * (1 + reps / 30.0)) AS rm, MAX(carga) AS carga, COUNT(*) AS n
           FROM series WHERE exercicio_id = ? AND tipo IN ('normal','falha')`,
          b.exercicio_id
        );

        const series: Serie[] = [];
        for (let i = 0; i < b.planejadas; i++) {
          const u = ultimas[i] ?? ultimas[ultimas.length - 1];
          series.push({
            carga: "",
            reps: "",
            tipo: "normal",
            feita: false,
            refCarga: u ? String(u.carga) : "",
            refReps: u ? String(u.reps) : "",
          });
        }
        resultado.push({
          exercicioId: b.exercicio_id,
          nome: b.nome,
          nota: b.nota ?? "",
          series,
          temHistorico: (hist?.n ?? 0) > 0,
          melhorRm: hist?.rm ?? 0,
          melhorCarga: hist?.carga ?? 0,
        });
      }

      let veioRascunho = false;
      if (usarRascunho) {
        const r = await db.getFirstAsync<{ dados: string; atualizado: string }>(
          "SELECT dados, atualizado FROM rascunhos WHERE treino_id = ?",
          treinoId
        );
        if (r) {
          const idade = Date.now() - new Date(r.atualizado).getTime();
          if (idade < VALIDADE_RASCUNHO_MS) {
            try {
              const salvo: any[] = JSON.parse(r.dados);
              resultado = resultado.map((e) => {
                const s = salvo.find((x) => x.exercicioId === e.exercicioId);
                if (!s) return e;
                const series: Serie[] = s.series.map((x: any, i: number) => ({
                  ...(e.series[i] ?? { refCarga: x.refCarga ?? "", refReps: x.refReps ?? "" }),
                  carga: x.carga ?? "",
                  reps: x.reps ?? "",
                  tipo: (x.tipo ?? (x.aquecimento ? "aq" : "normal")) as Tipo,
                  feita: !!x.feita,
                }));
                return { ...e, series };
              });
              veioRascunho = true;
            } catch {
              // rascunho corrompido: ignora
            }
          } else {
            await db.runAsync("DELETE FROM rascunhos WHERE treino_id = ?", treinoId);
          }
        }
      }

      setExs(resultado);
      setRestaurado(veioRascunho);
      const primeiro = resultado.findIndex((e) => e.series.some((s) => !s.feita));
      setAberto(primeiro === -1 ? null : primeiro);
      setCarregado(true);
    },
    [db, treinoId]
  );

  useEffect(() => {
    carregar(true);
  }, [carregar]);

  // ---------- rascunho automático ----------
  useEffect(() => {
    if (!carregado || finalizado.current) return;
    const timer = setTimeout(async () => {
      if (finalizado.current) return;
      const temAlgo = exs.some((e) =>
        e.series.some((s) => s.feita || s.carga !== "" || s.reps !== "" || s.tipo !== "normal")
      );
      try {
        if (temAlgo) {
          await db.runAsync(
            "INSERT OR REPLACE INTO rascunhos (treino_id, dados, atualizado) VALUES (?, ?, ?)",
            treinoId,
            JSON.stringify(exs),
            new Date().toISOString()
          );
        } else {
          await db.runAsync("DELETE FROM rascunhos WHERE treino_id = ?", treinoId);
        }
      } catch {
        // falha ao gravar rascunho não deve travar o treino
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [exs, carregado, db, treinoId]);

  function descartar() {
    Alert.alert("Descartar rascunho", "Apagar o que foi preenchido e recomeçar este treino?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Descartar",
        style: "destructive",
        onPress: async () => {
          await db.runAsync("DELETE FROM rascunhos WHERE treino_id = ?", treinoId);
          setFim(null);
          await carregar(false);
        },
      },
    ]);
  }

  // ---------- ações nas séries ----------
  function atualizar(ei: number, si: number, campo: Partial<Serie>) {
    setExs((prev) =>
      prev.map((e, i) =>
        i !== ei
          ? e
          : { ...e, series: e.series.map((s, j) => (j !== si ? s : { ...s, ...campo })) }
      )
    );
  }

  function marcar(ei: number, si: number) {
    const ex = exs[ei];
    const s = ex.series[si];

    if (s.feita) {
      atualizar(ei, si, { feita: false });
      return;
    }

    // campo vazio = repete o valor da última vez (marca d'água)
    const carga = s.carga !== "" ? s.carga : s.refCarga;
    const reps = s.reps !== "" ? s.reps : s.refReps;
    const c = parseFloat(carga.replace(",", "."));
    const r = parseInt(reps, 10);

    if (isNaN(c) || isNaN(r) || r <= 0) {
      Alert.alert("Faltam dados", "Preencha a carga e as repetições desta série.");
      return;
    }

    const novas = ex.series.map((x, j) => (j === si ? { ...x, carga, reps, feita: true } : x));
    setExs((prev) => prev.map((e, i) => (i !== ei ? e : { ...e, series: novas })));
    Keyboard.dismiss();

    if (s.tipo !== "aq") setFim(Date.now() + duracao * 1000);

    if (calcularPR({ ...ex, series: novas }, si)) {
      Vibration.vibrate([0, 80, 60, 80, 60, 160]);
    }

    // terminou o exercício: recolhe e abre o próximo com série pendente
    if (novas.every((x) => x.feita)) {
      const prox = exs.findIndex((e, i) => i > ei && e.series.some((x) => !x.feita));
      setAberto(prox === -1 ? null : prox);
    }
  }

  function addSerie(ei: number) {
    setExs((prev) =>
      prev.map((e, i) => {
        if (i !== ei) return e;
        const u = e.series[e.series.length - 1];
        return {
          ...e,
          series: [
            ...e.series,
            {
              carga: "",
              reps: "",
              tipo: "normal" as Tipo,
              feita: false,
              refCarga: u ? u.carga || u.refCarga : "",
              refReps: u ? u.reps || u.refReps : "",
            },
          ],
        };
      })
    );
  }

  function removerSerie(ei: number) {
    setExs((prev) =>
      prev.map((e, i) => (i !== ei ? e : { ...e, series: e.series.slice(0, -1) }))
    );
  }

  // ---------- notas ----------
  async function salvarNota() {
    if (!notaEdit) return;
    const { ei, texto } = notaEdit;
    const limpo = texto.trim();
    await db.runAsync(
      "UPDATE exercicios SET nota = ? WHERE id = ?",
      limpo === "" ? null : limpo,
      exs[ei].exercicioId
    );
    setExs((prev) => prev.map((e, i) => (i !== ei ? e : { ...e, nota: limpo })));
    setNotaEdit(null);
  }

  // ---------- salvar sessão ----------
  async function salvar() {
    const validas = exs.flatMap((e) =>
      e.series
        .filter((s) => s.feita)
        .map((s) => {
          const { c, r } = lerSerie(s);
          return { exercicioId: e.exercicioId, carga: c, reps: r, tipo: s.tipo };
        })
        .filter((s) => !isNaN(s.carga) && !isNaN(s.reps) && s.reps > 0)
    );

    if (validas.length === 0) {
      Alert.alert("Nada para salvar", "Marque com ✓ as séries que você fez.");
      return;
    }

    finalizado.current = true;

    await db.withTransactionAsync(async () => {
      const r = await db.runAsync(
        "INSERT INTO sessoes (treino_id, data) VALUES (?, ?)",
        treinoId,
        new Date().toISOString()
      );
      for (const s of validas) {
        await db.runAsync(
          `INSERT INTO series (sessao_id, exercicio_id, carga, reps, aquecimento, tipo)
           VALUES (?, ?, ?, ?, ?, ?)`,
          r.lastInsertRowId,
          s.exercicioId,
          s.carga,
          s.reps,
          s.tipo === "aq" ? 1 : 0,
          s.tipo
        );
      }
      await db.runAsync("DELETE FROM rascunhos WHERE treino_id = ?", treinoId);
    });

    Alert.alert("Treino salvo!", `${validas.length} séries registradas.`, [
      { text: "OK", onPress: () => router.replace("/") },
    ]);
  }

  const total = exs.reduce((a, e) => a + e.series.length, 0);
  const feitas = exs.reduce((a, e) => a + e.series.filter((s) => s.feita).length, 0);
  const pct = total > 0 ? Math.round((feitas / total) * 100) : 0;

  if (carregado && exs.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: nomeTreino }} />
        <Text style={styles.vazio}>
          Este treino ainda não tem exercícios. Adicione na tela "Editar treino".
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + 12 }]}>
      <Stack.Screen options={{ title: nomeTreino }} />

      {restaurado && (
        <View style={styles.aviso}>
          <Text style={styles.avisoTexto}>Treino em andamento restaurado</Text>
          <Pressable onPress={descartar}>
            <Text style={styles.avisoLink}>Descartar</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.progressoTopo}>
        <Text style={styles.progressoTexto}>
          {feitas} de {total} séries
        </Text>
        <View style={styles.progressoFundo}>
          <View style={[styles.progressoBarra, { width: `${pct}%` }]} />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        onScroll={(ev) => {
          scrollY.current = ev.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 16 + kbAltura }}
      >
        {exs.map((e, ei) => {
          const feitasEx = e.series.filter((s) => s.feita).length;
          const completo = e.series.length > 0 && feitasEx === e.series.length;
          const estaAberto = aberto === ei;
          const ref = e.series[0];
          const temPR = e.series.some((_, si) => calcularPR(e, si));

          return (
            <View key={e.exercicioId} style={[styles.card, completo && styles.cardCompleto]}>
              <Pressable style={styles.cabecalho} onPress={() => setAberto(estaAberto ? null : ei)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.nome} numberOfLines={1}>
                    {e.nome}
                    {temPR ? " 🏆" : ""}
                  </Text>
                  <Text style={styles.resumo}>
                    {feitasEx}/{e.series.length} séries
                    {feitasEx === 0 && ref?.refCarga
                      ? ` · Última vez: ${ref.refCarga} kg × ${ref.refReps}`
                      : ""}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => setNotaEdit({ ei, texto: e.nota })}
                >
                  <Ionicons
                    name={e.nota ? "document-text" : "document-text-outline"}
                    size={22}
                    color={e.nota ? cores.aviso : cores.suave}
                  />
                </Pressable>
                {completo && <Ionicons name="checkmark-circle" size={24} color={cores.destaque} />}
                <Ionicons
                  name={estaAberto ? "chevron-up" : "chevron-down"}
                  size={22}
                  color={cores.suave}
                />
              </Pressable>

              {estaAberto && (
                <View style={styles.corpo}>
                  {e.nota ? <Text style={styles.notaTexto}>📝 {e.nota}</Text> : null}

                  {e.series.map((s, si) => {
                    const pr = calcularPR(e, si);
                    const chaveC = `${ei}-${si}-c`;
                    const chaveR = `${ei}-${si}-r`;
                    const tp = TIPOS[s.tipo];

                    return (
                      <View key={si}>
                        <View style={[styles.linha, s.feita && styles.linhaFeita]}>
                          <Text style={styles.num}>{si + 1}</Text>
                          <TextInput
                            ref={(r) => {
                              inputs.current[chaveC] = r;
                            }}
                            style={styles.input}
                            keyboardType="decimal-pad"
                            placeholder={s.refCarga || "kg"}
                            placeholderTextColor="#6b6b6b"
                            value={s.carga}
                            onChangeText={(t) => atualizar(ei, si, { carga: t })}
                            submitBehavior="submit"
                            onFocus={() => {
                              focoAtual.current = chaveC;
                              if (kbTopo.current > 0) setTimeout(rolarParaFoco, 60);
                            }}
                            onSubmitEditing={() => inputs.current[chaveR]?.focus()}
                          />
                          <Text style={styles.sep}>×</Text>
                          <TextInput
                            ref={(r) => {
                              inputs.current[chaveR] = r;
                            }}
                            style={styles.input}
                            keyboardType="number-pad"
                            placeholder={s.refReps || "reps"}
                            placeholderTextColor="#6b6b6b"
                            value={s.reps}
                            onChangeText={(t) => atualizar(ei, si, { reps: t })}
                            submitBehavior="submit"
                            onFocus={() => {
                              focoAtual.current = chaveR;
                              if (kbTopo.current > 0) setTimeout(rolarParaFoco, 60);
                            }}
                            onSubmitEditing={() => {
                              const prox = inputs.current[`${ei}-${si + 1}-c`];
                              if (prox) prox.focus();
                              else Keyboard.dismiss();
                            }}
                          />
                          <Pressable
                            style={[styles.tipo, { backgroundColor: tp.cor }]}
                            onPress={() => atualizar(ei, si, { tipo: tp.proximo })}
                          >
                            <Text style={[styles.tipoTexto, { color: tp.texto }]}>{tp.rotulo}</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.check, s.feita && styles.checkAtivo]}
                            onPress={() => marcar(ei, si)}
                          >
                            <Ionicons
                              name="checkmark"
                              size={22}
                              color={s.feita ? cores.texto : cores.suave}
                            />
                          </Pressable>
                        </View>
                        {pr && <Text style={styles.prTexto}>🏆 Novo PR!</Text>}
                      </View>
                    );
                  })}

                  <View style={styles.acoes}>
                    <Pressable onPress={() => addSerie(ei)}>
                      <Text style={styles.link}>+ série</Text>
                    </Pressable>
                    <Pressable onPress={() => removerSerie(ei)}>
                      <Text style={[styles.link, { color: cores.perigo }]}>− série</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* fica montado (o timer continua rodando) mas some enquanto o teclado está aberto */}
      <View style={tecladoAberto ? styles.oculto : undefined}>
        <BarraDescanso fim={fim} setFim={setFim} duracao={duracao} setDuracao={setDuracao} />
        <Pressable style={styles.salvar} onPress={salvar}>
          <Text style={styles.salvarTexto}>Finalizar e salvar</Text>
        </Pressable>
      </View>

      <Modal
        visible={notaEdit !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setNotaEdit(null)}
      >
        <View style={styles.modalFundo}>
          <View style={styles.modalCaixa}>
            <Text style={styles.modalTitulo}>{notaEdit ? exs[notaEdit.ei]?.nome : ""}</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              autoFocus
              placeholder="Ex.: pino do banco no 4, pegada pronada, descer em 3s"
              placeholderTextColor="#6b6b6b"
              value={notaEdit?.texto ?? ""}
              onChangeText={(t) => setNotaEdit((n) => (n ? { ...n, texto: t } : n))}
            />
            <View style={styles.modalAcoes}>
              <Pressable onPress={() => setNotaEdit(null)}>
                <Text style={styles.modalCancelar}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={salvarNota}>
                <Text style={styles.modalSalvar}>Salvar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: cores.fundo },
  vazio: { color: cores.suave, textAlign: "center", marginTop: 32 },
  oculto: { display: "none" },
  aviso: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#3a3217",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  avisoTexto: { color: cores.aviso, fontSize: 13 },
  avisoLink: { color: cores.texto, fontSize: 13, fontWeight: "700" },
  progressoTopo: { marginBottom: 12 },
  progressoTexto: { color: cores.suave, fontSize: 13, marginBottom: 6 },
  progressoFundo: { height: 6, backgroundColor: cores.campo, borderRadius: 3, overflow: "hidden" },
  progressoBarra: { height: 6, backgroundColor: cores.destaque, borderRadius: 3 },
  card: { backgroundColor: cores.card, borderRadius: 14, marginBottom: 12, overflow: "hidden" },
  cardCompleto: { borderWidth: 1, borderColor: cores.primaria },
  cabecalho: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  nome: { color: cores.texto, fontSize: 18, fontWeight: "700" },
  resumo: { color: cores.suave, fontSize: 13, marginTop: 2 },
  corpo: { paddingHorizontal: 14, paddingBottom: 14 },
  notaTexto: {
    color: cores.aviso,
    fontSize: 13,
    backgroundColor: "#2a2614",
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  linha: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    padding: 4,
    borderRadius: 12,
  },
  linhaFeita: { backgroundColor: "#1b3a1f" },
  num: { color: cores.suave, width: 20, textAlign: "center" },
  input: {
    flex: 1,
    backgroundColor: cores.campo,
    color: cores.texto,
    borderRadius: 8,
    paddingVertical: 10,
    textAlign: "center",
    fontSize: 18,
  },
  sep: { color: cores.suave, fontSize: 18 },
  tipo: {
    width: 52,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  tipoTexto: { fontSize: 12, fontWeight: "700" },
  check: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: cores.campo,
    alignItems: "center",
    justifyContent: "center",
  },
  checkAtivo: { backgroundColor: cores.primaria },
  prTexto: { color: cores.aviso, fontSize: 13, fontWeight: "700", marginLeft: 32, marginBottom: 6 },
  acoes: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  link: { color: cores.destaque, fontSize: 15 },
  salvar: {
    backgroundColor: cores.primaria,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 10,
  },
  salvarTexto: { color: cores.texto, fontSize: 18, fontWeight: "700" },
  modalFundo: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-start",
    padding: 20,
    paddingTop: 90,
  },
  modalCaixa: { backgroundColor: cores.card, borderRadius: 16, padding: 18 },
  modalTitulo: { color: cores.texto, fontSize: 18, fontWeight: "700", marginBottom: 12 },
  modalInput: {
    backgroundColor: cores.campo,
    color: cores.texto,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 16,
    textAlignVertical: "top",
  },
  modalAcoes: { flexDirection: "row", justifyContent: "flex-end", gap: 24, marginTop: 16 },
  modalCancelar: { color: cores.suave, fontSize: 16 },
  modalSalvar: { color: cores.destaque, fontSize: 16, fontWeight: "700" },
});