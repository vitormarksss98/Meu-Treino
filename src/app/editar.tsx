import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

type Treino = { id: number; nome: string };

export default function Editar() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [treinos, setTreinos] = useState<Treino[]>([]);
  const [nome, setNome] = useState("");

  const carregar = useCallback(async () => {
    const lista = await db.getAllAsync<Treino>(
      "SELECT id, nome FROM treinos ORDER BY nome"
    );
    setTreinos(lista);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  async function adicionar() {
    const n = nome.trim();
    if (!n) return;
    await db.runAsync("INSERT INTO treinos (nome) VALUES (?)", n);
    setNome("");
    carregar();
  }

  function excluir(t: Treino) {
    Alert.alert("Excluir treino", `Excluir "${t.nome}"? O histórico é mantido.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          await db.runAsync("DELETE FROM treinos WHERE id = ?", t.id);
          carregar();
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.linha}>
        <TextInput
          style={styles.input}
          placeholder="Novo treino (ex: Treino A)"
          placeholderTextColor="#888"
          value={nome}
          onChangeText={setNome}
          onSubmitEditing={adicionar}
        />
        <Pressable style={styles.botaoAdd} onPress={adicionar}>
          <Text style={styles.textoBotao}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={treinos}
        keyExtractor={(t) => String(t.id)}
        ListEmptyComponent={
          <Text style={styles.vazio}>Nenhum treino ainda. Crie o primeiro acima.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.item}
            onPress={() => router.push(`/treino/${item.id}`)}
            onLongPress={() => excluir(item)}
          >
            <Text style={styles.textoItem}>{item.nome}</Text>
          </Pressable>
        )}
      />
      <Text style={styles.dica}>Toque para editar. Segure para excluir.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#121212" },
  linha: { flexDirection: "row", gap: 8, marginBottom: 16 },
  input: {
    flex: 1,
    backgroundColor: "#1e1e1e",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
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
  item: {
    backgroundColor: "#1e1e1e",
    padding: 18,
    borderRadius: 10,
    marginBottom: 10,
  },
  textoItem: { color: "#fff", fontSize: 18 },
  vazio: { color: "#888", textAlign: "center", marginTop: 32 },
  dica: { color: "#666", textAlign: "center", paddingTop: 8 },
});