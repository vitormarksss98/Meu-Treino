import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { cores } from "../lib/tema";

type Icone = React.ComponentProps<typeof Ionicons>["name"];

function dataCurta(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type CartaoProps = {
  icone: Icone;
  titulo: string;
  descricao: string;
  destaque?: boolean;
  onPress: () => void;
};

function Cartao({ icone, titulo, descricao, destaque, onPress }: CartaoProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cartao,
        destaque && styles.cartaoDestaque,
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={[styles.iconeBox, destaque && styles.iconeBoxDestaque]}>
        <Ionicons name={icone} size={28} color={destaque ? cores.texto : cores.destaque} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cartaoTitulo}>{titulo}</Text>
        <Text style={[styles.cartaoDescricao, destaque && { color: "#d7ecd8" }]}>{descricao}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={destaque ? cores.texto : cores.suave} />
    </Pressable>
  );
}

export default function Inicio() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [semana, setSemana] = useState(0);
  const [ultimo, setUltimo] = useState("—");

  useFocusEffect(
    useCallback(() => {
      async function carregar() {
        const corte = new Date(Date.now() - 7 * 86400000).toISOString();
        const s = await db.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sessoes WHERE data >= ?",
          corte
        );
        setSemana(s?.n ?? 0);

        const u = await db.getFirstAsync<{ data: string; nome: string | null }>(
          `SELECT se.data, t.nome
           FROM sessoes se LEFT JOIN treinos t ON t.id = se.treino_id
           ORDER BY se.data DESC LIMIT 1`
        );
        setUltimo(u ? `${u.nome ?? "Treino"} · ${dataCurta(u.data)}` : "—");
      }
      carregar();
    }, [db])
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topo}>
        <Text style={styles.saudacao}>Bora treinar 💪</Text>
        <Text style={styles.titulo}>Meu Treino</Text>
      </View>

      <View style={styles.resumo}>
        <View style={styles.caixa}>
          <Text style={styles.caixaValor}>{semana}</Text>
          <Text style={styles.caixaTitulo}>treinos nos últimos 7 dias</Text>
        </View>
        <View style={styles.caixa}>
          <Text style={styles.caixaValor} numberOfLines={1}>{ultimo}</Text>
          <Text style={styles.caixaTitulo}>último treino</Text>
        </View>
      </View>

      <View style={styles.lista}>
        <Cartao
          destaque
          icone="barbell-outline"
          titulo="Registrar treino"
          descricao="Anote cargas e repetições de hoje"
          onPress={() => router.push("/registrar")}
        />
        <Cartao
          icone="create-outline"
          titulo="Editar treino"
          descricao="Monte seus treinos e exercícios"
          onPress={() => router.push("/editar")}
        />
        <Cartao
          icone="stats-chart-outline"
          titulo="Ver gráfico"
          descricao="Acompanhe sua evolução"
          onPress={() => router.push("/grafico")}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo, paddingHorizontal: 20 },
  topo: { marginTop: 24, marginBottom: 20 },
  saudacao: { color: cores.suave, fontSize: 16 },
  titulo: { color: cores.texto, fontSize: 34, fontWeight: "800", marginTop: 4 },
  resumo: { flexDirection: "row", gap: 12, marginBottom: 24 },
  caixa: { flex: 1, backgroundColor: cores.card, borderRadius: 14, padding: 14 },
  caixaValor: { color: cores.texto, fontSize: 20, fontWeight: "700" },
  caixaTitulo: { color: cores.suave, fontSize: 12, marginTop: 4 },
  lista: { gap: 14 },
  cartao: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: cores.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  cartaoDestaque: { backgroundColor: cores.primaria, borderColor: cores.primaria, paddingVertical: 24 },
  iconeBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: cores.campo,
    alignItems: "center",
    justifyContent: "center",
  },
  iconeBoxDestaque: { backgroundColor: "rgba(255,255,255,0.18)" },
  cartaoTitulo: { color: cores.texto, fontSize: 19, fontWeight: "700" },
  cartaoDescricao: { color: cores.suave, fontSize: 13, marginTop: 2 },
});