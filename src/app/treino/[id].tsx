import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

type Item = { id: number; nome: string; series: number };

export default function TreinoDetalhe() {
  const db = useSQLiteContext();
  const { id } = useLocalSearchParams<{ id: string }>();
  const treinoId = Number(id);

  const [itens, setItens] = useState<Item[]>([]);
  const [nome, setNome] = useState("");
  const [series, setSeries] = useState("3");

  const carregar = useCallback(async () => {
    const lista = await db.getAllAsync<Item>(
      `SELECT te.id, e.nome, te.series_planejadas AS series
       FROM treino_exercicios te
       JOIN exercicios e ON e.id = te.exercicio_id
       WHERE te.treino_id = ?
       ORDER BY te.ordem, te.id`,
      treinoId
    );
    setItens(lista);
  }, [db, treinoId]);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  async function adicionar() {
    const n = nome.trim();
    if (!n) return;

    // reaproveita o exercício se já existir (assim o histórico fica junto)
    const existente = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM exercicios WHERE nome = ? COLLATE NOCASE",
      n
    );
    let exercicioId: number;
    if (existente) {
      exercicioId = existente.id;
    } else {
      const r = await db.runAsync("INSERT INTO exercicios (nome) VALUES (?)", n);
      exercicioId = r.lastInsertRowId;
    }

    await db.runAsync(
      `INSERT INTO treino_exercicios (treino_id, exercicio_id, series_planejadas, ordem)
       VALUES (?, ?, ?, ?)`,
      treinoId,
      exercicioId,
      Number(series) || 3,
      itens.length
    );
    setNome("");
    carregar();
  }

  async function remover(itemId: number) {
    await db.runAsync("DELETE FROM treino_exercicios WHERE id = ?", itemId);
    carregar();
  }

  return (
    <View style={styles.container}>
      <View style={styles.linha}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Exercício (ex: Supino reto)"
          placeholderTextColor="#888"
          value={nome}
          onChangeText={setNome}
        />
        <TextInput
          style={[styles.input, { width: 56, textAlign: "center" }]}
          keyboardType="number-pad"
          value={series}
          onChangeText={setSeries}
        />
        <Pressable style={styles.botaoAdd} onPress={adicionar}>
          <Text style={styles.textoBotao}>+</Text>
        </Pressable>
      </View>
      <Text style={styles.legenda}>O número ao lado é a quantidade de séries.</Text>

      <FlatList
        data={itens}
        keyExtractor={(i) => String(i.id)}
        ListEmptyComponent={<Text style={styles.vazio}>Nenhum exercício neste treino.</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.textoItem}>
              {item.nome} · {item.series}x
            </Text>
            <Pressable onPress={() => remover(item.id)}>
              <Text style={styles.remover}>✕</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#121212" },
  linha: { flexDirection: "row", gap: 8 },
  input: {
    backgroundColor: "#1e1e1e",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  botaoAdd: {
    backgroundColor: "#2e7d32",
    width: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  textoBotao: { color: "#fff", fontSize: 28, fontWeight: "600" },
  legenda: { color: "#666", fontSize: 12, marginVertical: 8 },
  item: {
    backgroundColor: "#1e1e1e",
    padding: 18,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textoItem: { color: "#fff", fontSize: 18 },
  remover: { color: "#e57373", fontSize: 20, paddingHorizontal: 8 },
  vazio: { color: "#888", textAlign: "center", marginTop: 32 },
});