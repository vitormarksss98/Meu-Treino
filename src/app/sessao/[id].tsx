import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { cores } from "../../lib/tema";
import BarraDescanso from "../../components/BarraDescanso";

type Serie = {
  carga: string;
  reps: string;
  aquecimento: boolean;
  feita: boolean;
  refCarga: string; // valor da última vez (marca d'água)
  refReps: string;
};
type Ex = { exercicioId: number; nome: string; series: Serie[] };

const VALIDADE_RASCUNHO_MS = 12 * 60 * 60 * 1000; // 12 horas

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
  const finalizado = useRef(false);

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
        planejadas: number;
      }>(
        `SELECT te.exercicio_id, e.nome, te.series_planejadas AS planejadas
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
           WHERE exercicio_id = ? AND aquecimento = 0
             AND sessao_id = (SELECT MAX(sessao_id) FROM series
                              WHERE exercicio_id = ? AND aquecimento = 0)
           ORDER BY id`,
          b.exercicio_id,
          b.exercicio_id
        );
        const series: Serie[] = [];
        for (let i = 0; i < b.planejadas; i++) {
          // se a última vez teve menos séries, repete a última como referência
          const u = ultimas[i] ?? ultimas[ultimas.length - 1];
          series.push({
            carga: "",
            reps: "",
            aquecimento: false,
            feita: false,
            refCarga: u ? String(u.carga) : "",
            refReps: u ? String(u.reps) : "",
          });
        }
        resultado.push({ exercicioId: b.exercicio_id, nome: b.nome, series });
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
              const salvo: Ex[] = JSON.parse(r.dados);
              resultado = resultado.map((e) => {
                const s = salvo.find((x) => x.exercicioId === e.exercicioId);
                return s ? { ...e, series: s.series } : e;
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

  // rascunho automático: grava 0,6s depois da última alteração
  useEffect(() => {
    if (!carregado || finalizado.current) return;
    const timer = setTimeout(async () => {
      if (finalizado.current) return;
      const temAlgo = exs.some((e) =>
        e.series.some((s) => s.feita || s.carga !== "" || s.reps !== "" || s.aquecimento)
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
    const s = exs[ei].series[si];

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

    const novas = exs[ei].series.map((x, j) =>
      j === si ? { ...x, carga, reps, feita: true } : x
    );
    setExs((prev) => prev.map((e, i) => (i !== ei ? e : { ...e, series: novas })));

    if (!s.aquecimento) setFim(Date.now() + duracao * 1000);

    // terminou o exercício: recolhe e abre o próximo que ainda tem série pendente
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
              aquecimento: false,
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

  async function salvar() {
    const validas = exs.flatMap((e) =>
      e.series
        .filter((s) => s.feita)
        .map((s) => ({
          exercicioId: e.exercicioId,
          carga: parseFloat(s.carga.replace(",", ".")),
          reps: parseInt(s.reps, 10),
          aquecimento: s.aquecimento ? 1 : 0,
        }))
        .filter((s) => !isNaN(s.carga) && !isNaN(s.reps) && s.reps > 0)
    );

    if (validas.length === 0) {
      Alert.alert("Nada para salvar", "Marque com ✓ as séries que você fez.");
      return;
    }

    finalizado.current = true; // impede o rascunho de ser regravado

    await db.withTransactionAsync(async () => {
      const r = await db.runAsync(
        "INSERT INTO sessoes (treino_id, data) VALUES (?, ?)",
        treinoId,
        new Date().toISOString()
      );
      for (const s of validas) {
        await db.runAsync(
          `INSERT INTO series (sessao_id, exercicio_id, carga, reps, aquecimento)
           VALUES (?, ?, ?, ?, ?)`,
          r.lastInsertRowId,
          s.exercicioId,
          s.carga,
          s.reps,
          s.aquecimento
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

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
        {exs.map((e, ei) => {
          const feitasEx = e.series.filter((s) => s.feita).length;
          const completo = e.series.length > 0 && feitasEx === e.series.length;
          const estaAberto = aberto === ei;
          const ref = e.series[0];

          return (
            <View key={e.exercicioId} style={[styles.card, completo && styles.cardCompleto]}>
              <Pressable
                style={styles.cabecalho}
                onPress={() => setAberto(estaAberto ? null : ei)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.nome}>{e.nome}</Text>
                  <Text style={styles.resumo}>
                    {feitasEx}/{e.series.length} séries
                    {feitasEx === 0 && ref?.refCarga
                      ? ` · Última vez: ${ref.refCarga} kg × ${ref.refReps}`
                      : ""}
                  </Text>
                </View>
                {completo && (
                  <Ionicons name="checkmark-circle" size={24} color={cores.destaque} />
                )}
                <Ionicons
                  name={estaAberto ? "chevron-up" : "chevron-down"}
                  size={22}
                  color={cores.suave}
                />
              </Pressable>

              {estaAberto && (
                <View style={styles.corpo}>
                  {e.series.map((s, si) => (
                    <View key={si} style={[styles.linha, s.feita && styles.linhaFeita]}>
                      <Text style={styles.num}>{si + 1}</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="decimal-pad"
                        placeholder={s.refCarga || "kg"}
                        placeholderTextColor="#6b6b6b"
                        value={s.carga}
                        onChangeText={(t) => atualizar(ei, si, { carga: t })}
                      />
                      <Text style={styles.sep}>×</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="number-pad"
                        placeholder={s.refReps || "reps"}
                        placeholderTextColor="#6b6b6b"
                        value={s.reps}
                        onChangeText={(t) => atualizar(ei, si, { reps: t })}
                      />
                      <Pressable
                        style={[styles.aq, s.aquecimento && styles.aqAtivo]}
                        onPress={() => atualizar(ei, si, { aquecimento: !s.aquecimento })}
                      >
                        <Text style={styles.aqTexto}>Aq.</Text>
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
                  ))}

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

      <BarraDescanso fim={fim} setFim={setFim} duracao={duracao} setDuracao={setDuracao} />

      <Pressable style={styles.salvar} onPress={salvar}>
        <Text style={styles.salvarTexto}>Finalizar e salvar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: cores.fundo },
  vazio: { color: cores.suave, textAlign: "center", marginTop: 32 },
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
  cabecalho: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  nome: { color: cores.texto, fontSize: 18, fontWeight: "700" },
  resumo: { color: cores.suave, fontSize: 13, marginTop: 2 },
  corpo: { paddingHorizontal: 14, paddingBottom: 14 },
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
  aq: { paddingHorizontal: 10, paddingVertical: 12, borderRadius: 8, backgroundColor: cores.campo },
  aqAtivo: { backgroundColor: cores.aviso },
  aqTexto: { color: cores.texto, fontSize: 12 },
  check: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: cores.campo,
    alignItems: "center",
    justifyContent: "center",
  },
  checkAtivo: { backgroundColor: cores.primaria },
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
});