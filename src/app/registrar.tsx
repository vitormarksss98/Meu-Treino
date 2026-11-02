import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";

type Treino = { id: number; nome: string };

export default function Registrar() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [treinos, setTreinos] = useState<Treino[]>([]);

  useFocusEffect(
    useCallback(() => {
      db.getAllAsync<Treino>("SELECT id, nome FROM treinos ORDER BY nome").then(setTreinos);
    }, [db])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Qual treino de hoje?</Text>
      <FlatList
        data={treinos}
        keyExtractor={(t) => String(t.id)}
        ListEmptyComponent={
          <Text style={styles.vazio}>
            Nenhum treino cadastrado. Crie um na tela "Editar treino".
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.item} onPress={() => router.push(`/sessao/${item.id}`)}>
            <Text style={styles.textoItem}>{item.nome}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#121212" },
  titulo: { color: "#fff", fontSize: 22, fontWeight: "600", marginBottom: 16 },
  item: { backgroundColor: "#1e1e1e", padding: 20, borderRadius: 10, marginBottom: 10 },
  textoItem: { color: "#fff", fontSize: 18 },
  vazio: { color: "#888", textAlign: "center", marginTop: 32 },
});