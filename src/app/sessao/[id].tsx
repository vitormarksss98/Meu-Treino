import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { cores } from "../../lib/tema";
import BarraDescanso from "../../components/BarraDescanso";

type Serie = { carga: string; reps: string; aquecimento: boolean; feita: boolean };
type Ex = { exercicioId: number; nome: string; series: Serie[] };

export default function Sessao() {
  useKeepAwake(); // mantém a tela ligada durante o treino

  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const treinoId = Number(id);

  const [nomeTreino, setNomeTreino] = useState("Treino de hoje");
  const [exs, setExs] = useState<Ex[]>([]);
  const [duracao, setDuracao] = useState(90);
  const [fim, setFim] = useState<number | null>(null);

  useEffect(() => {
    async function carregar() {
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

      const resultado: Ex[] = [];
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
          const u = ultimas[i];
          series.push({
            carga: u ? String(u.carga) : "",
            reps: u ? String(u.reps) : "",
            aquecimento: false,
            feita: false,
          });
        }
        resultado.push({ exercicioId: b.exercicio_id, nome: b.nome, series });
      }
      setExs(resultado);
    }
    carregar();
  }, [db, treinoId]);

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
    const nova = !s.feita;
    atualizar(ei, si, { feita: nova });
    // inicia o descanso ao concluir uma série de trabalho (não de aquecimento)
    if (nova && !s.aquecimento) setFim(Date.now() + duracao * 1000);
  }

  function addSerie(ei: number) {
    setExs((prev) =>
      prev.map((e, i) => {
        if (i !== ei) return e;
        const ultima = e.series[e.series.length - 1];
        return {
          ...e,
          series: [
            ...e.series,
            { carga: ultima?.carga ?? "", reps: ultima?.reps ?? "", aquecimento: false, feita: false },
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
    // só entram séries marcadas com ✓
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
      Alert.alert(
        "Nada para salvar",
        "Marque com ✓ as séries que você fez (com carga e repetições preenchidas)."
      );
      return;
    }

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
    });

    Alert.alert("Treino salvo!", `${validas.length} séries registradas.`, [
      { text: "OK", onPress: () => router.replace("/") },
    ]);
  }

  const total = exs.reduce((a, e) => a + e.series.length, 0);
  const feitas = exs.reduce((a, e) => a + e.series.filter((s) => s.feita).length, 0);
  const pct = total > 0 ? Math.round((feitas / total) * 100) : 0;

  if (exs.length === 0) {
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

      <View style={styles.progressoTopo}>
        <Text style={styles.progressoTexto}>
          {feitas} de {total} séries
        </Text>
        <View style={styles.progressoFundo}>
          <View style={[styles.progressoBarra, { width: `${pct}%` }]} />
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
        {exs.map((e, ei) => (
          <View key={e.exercicioId} style={styles.card}>
            <Text style={styles.nome}>{e.nome}</Text>

            {e.series.map((s, si) => (
              <View key={si} style={[styles.linha, s.feita && styles.linhaFeita]}>
                <Text style={styles.num}>{si + 1}</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="kg"
                  placeholderTextColor="#666"
                  value={s.carga}
                  onChangeText={(t) => atualizar(ei, si, { carga: t })}
                />
                <Text style={styles.sep}>×</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholder="reps"
                  placeholderTextColor="#666"
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
                  <Ionicons name="checkmark" size={22} color={s.feita ? cores.texto : cores.suave} />
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
        ))}
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
  progressoTopo: { marginBottom: 12 },
  progressoTexto: { color: cores.suave, fontSize: 13, marginBottom: 6 },
  progressoFundo: { height: 6, backgroundColor: cores.campo, borderRadius: 3, overflow: "hidden" },
  progressoBarra: { height: 6, backgroundColor: cores.destaque, borderRadius: 3 },
  card: { backgroundColor: cores.card, borderRadius: 14, padding: 14, marginBottom: 14 },
  nome: { color: cores.texto, fontSize: 18, fontWeight: "700", marginBottom: 10 },
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