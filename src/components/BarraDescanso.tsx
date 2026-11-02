import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { cores } from "../lib/tema";

const PRESETS = [60, 90, 120, 180];

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Props = {
  fim: number | null;
  setFim: (v: number | null) => void;
  duracao: number;
  setDuracao: (v: number) => void;
};

export default function BarraDescanso({ fim, setFim, duracao, setDuracao }: Props) {
  const [agora, setAgora] = useState(Date.now());

  // atualiza o relógio 4x por segundo enquanto o timer está ativo
  useEffect(() => {
    if (fim === null) return;
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(id);
  }, [fim]);

  const restante = fim === null ? 0 : Math.max(0, Math.ceil((fim - agora) / 1000));

  // acabou o tempo: vibra e desliga
  useEffect(() => {
    if (fim !== null && restante === 0) {
      Vibration.vibrate([0, 400, 200, 400]);
      setFim(null);
    }
  }, [fim, restante, setFim]);

  if (fim !== null) {
    const acabando = restante <= 10;
    return (
      <View style={[styles.barra, styles.barraAtiva]}>
        <Ionicons name="timer-outline" size={22} color={cores.texto} />
        <Text style={[styles.tempo, acabando && { color: cores.aviso }]}>{mmss(restante)}</Text>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.botaoPequeno} onPress={() => setFim(fim - 15000)}>
          <Text style={styles.botaoTexto}>−15s</Text>
        </Pressable>
        <Pressable style={styles.botaoPequeno} onPress={() => setFim(fim + 15000)}>
          <Text style={styles.botaoTexto}>+15s</Text>
        </Pressable>
        <Pressable style={[styles.botaoPequeno, { backgroundColor: cores.perigo }]} onPress={() => setFim(null)}>
          <Text style={styles.botaoTexto}>Pular</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.barra}>
      <Ionicons name="timer-outline" size={22} color={cores.suave} />
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Pressable
            key={p}
            style={[styles.chip, duracao === p && styles.chipAtivo]}
            onPress={() => setDuracao(p)}
          >
            <Text style={styles.chipTexto}>{p >= 60 ? `${p / 60}min` : `${p}s`}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={styles.iniciar} onPress={() => setFim(Date.now() + duracao * 1000)}>
        <Ionicons name="play" size={18} color={cores.texto} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: cores.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: cores.borda,
  },
  barraAtiva: { backgroundColor: "#1b3a1f", borderColor: cores.primaria },
  tempo: { color: cores.texto, fontSize: 28, fontWeight: "700", fontVariant: ["tabular-nums"] },
  presets: { flex: 1, flexDirection: "row", gap: 6 },
  chip: { backgroundColor: cores.campo, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16 },
  chipAtivo: { backgroundColor: cores.primaria },
  chipTexto: { color: cores.texto, fontSize: 13 },
  iniciar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: cores.primaria,
    alignItems: "center",
    justifyContent: "center",
  },
  botaoPequeno: { backgroundColor: cores.campo, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  botaoTexto: { color: cores.texto, fontSize: 13, fontWeight: "600" },
});