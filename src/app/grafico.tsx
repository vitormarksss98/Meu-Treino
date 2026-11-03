import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LineChart } from "react-native-gifted-charts";

type Exercicio = { id: number; nome: string };
type Linha = { sessao_id: number; data: string; carga: number; reps: number; tipo: string };
type Ponto = { data: string; label: string; rm: number; carga: number; volume: number };
type Metrica = "rm" | "carga" | "volume";

const METRICAS: { chave: Metrica; nome: string }[] = [
  { chave: "rm", nome: "1RM estimado" },
  { chave: "carga", nome: "Maior carga" },
  { chave: "volume", nome: "Volume" },
];
const PERIODOS = [
  { dias: 30, nome: "30 dias" },
  { dias: 90, nome: "90 dias" },
  { dias: 0, nome: "Tudo" },
];

function formatarData(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function arredondar(n: number) {
  return Math.round(n * 10) / 10;
}

export default function Grafico() {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();

  const [exercicios, setExercicios] = useState<Exercicio[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [dias, setDias] = useState(90);
  const [metrica, setMetrica] = useState<Metrica>("rm");
  const [pontos, setPontos] = useState<Ponto[]>([]);

  // lista de exercícios que têm ao menos uma série válida (sem aquecimento)
  useFocusEffect(
    useCallback(() => {
      db.getAllAsync<Exercicio>(
        `SELECT DISTINCT e.id, e.nome
         FROM exercicios e
         JOIN series s ON s.exercicio_id = e.id
         WHERE s.tipo != 'aq'
         ORDER BY e.nome`
      ).then((lista) => {
        setExercicios(lista);
        setSelecionado((atual) => atual ?? lista[0]?.id ?? null);
      });
    }, [db])
  );

  useEffect(() => {
    async function carregar() {
      if (selecionado === null) {
        setPontos([]);
        return;
      }
      const corte = dias > 0 ? new Date(Date.now() - dias * 86400000).toISOString() : "";

            // aquecimento fica de fora de tudo; drop entra só no volume
      const linhas = await db.getAllAsync<Linha>(
        `SELECT se.id AS sessao_id, se.data, s.carga, s.reps, s.tipo
         FROM series s
         JOIN sessoes se ON se.id = s.sessao_id
         WHERE s.exercicio_id = ? AND s.tipo != 'aq' AND se.data >= ?
         ORDER BY se.data, s.id`,
        selecionado,
        corte
      );

      const porSessao = new Map<number, Ponto>();
      for (const l of linhas) {
        const conta = l.tipo === "normal" || l.tipo === "falha";
        const rm = conta ? l.carga * (1 + l.reps / 30) : 0;
        const cargaValida = conta ? l.carga : 0;
        const atual = porSessao.get(l.sessao_id);
        if (!atual) {
          porSessao.set(l.sessao_id, {
            data: l.data,
            label: formatarData(l.data),
            rm,
            carga: cargaValida,
            volume: l.carga * l.reps,
          });
        } else {
          atual.rm = Math.max(atual.rm, rm);
          atual.carga = Math.max(atual.carga, cargaValida);
          atual.volume += l.carga * l.reps;
        }
      }
      setPontos(
        Array.from(porSessao.values()).filter((p) =>
          metrica === "volume" ? p.volume > 0 : p[metrica] > 0
        )
      );
    }
    carregar();
  }, [db, selecionado, dias, metrica]);

  const valores = pontos.map((p) => arredondar(p[metrica]));
  const min = valores.length ? Math.min(...valores) : 0;
  const max = valores.length ? Math.max(...valores) : 0;
  const offset = Math.max(0, Math.floor(min * 0.9)); // evita o eixo começar do zero

  const primeiro = valores[0];
  const ultimo = valores[valores.length - 1];
  const variacao = valores.length > 1 && primeiro > 0 ? ((ultimo - primeiro) / primeiro) * 100 : null;

  if (exercicios.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.vazio}>
          Ainda não há séries válidas registradas. Registre um treino para ver o gráfico.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Text style={styles.secao}>Exercício</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {exercicios.map((e) => (
          <Pressable
            key={e.id}
            style={[styles.chip, selecionado === e.id && styles.chipAtivo]}
            onPress={() => setSelecionado(e.id)}
          >
            <Text style={styles.chipTexto}>{e.nome}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={styles.secao}>Métrica</Text>
      <View style={styles.chips}>
        {METRICAS.map((m) => (
          <Pressable
            key={m.chave}
            style={[styles.chip, metrica === m.chave && styles.chipAtivo]}
            onPress={() => setMetrica(m.chave)}
          >
            <Text style={styles.chipTexto}>{m.nome}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.secao}>Período</Text>
      <View style={styles.chips}>
        {PERIODOS.map((p) => (
          <Pressable
            key={p.dias}
            style={[styles.chip, dias === p.dias && styles.chipAtivo]}
            onPress={() => setDias(p.dias)}
          >
            <Text style={styles.chipTexto}>{p.nome}</Text>
          </Pressable>
        ))}
      </View>

      {pontos.length === 0 ? (
        <Text style={styles.vazio}>Nenhuma sessão neste período.</Text>
      ) : (
        <>
          <View style={styles.resumo}>
            <View style={styles.caixa}>
              <Text style={styles.caixaTitulo}>Último</Text>
              <Text style={styles.caixaValor}>{ultimo}</Text>
            </View>
            <View style={styles.caixa}>
              <Text style={styles.caixaTitulo}>Recorde</Text>
              <Text style={styles.caixaValor}>{max}</Text>
            </View>
            <View style={styles.caixa}>
              <Text style={styles.caixaTitulo}>Variação</Text>
              <Text
                style={[
                  styles.caixaValor,
                  variacao !== null && { color: variacao >= 0 ? "#66bb6a" : "#e57373" },
                ]}
              >
                {variacao === null ? "—" : `${variacao >= 0 ? "+" : ""}${variacao.toFixed(1)}%`}
              </Text>
            </View>
          </View>

          {pontos.length < 2 ? (
            <Text style={styles.vazio}>Registre pelo menos 2 sessões para ver a linha de evolução.</Text>
          ) : (
            <View style={styles.grafico}>
              <LineChart
                data={valores.map((v, i) => ({ value: v - offset, label: pontos[i].label }))}
                width={width - 100}
                height={220}
                initialSpacing={20}
                endSpacing={20}
                spacing={Math.max(50, (width - 140) / Math.max(1, pontos.length - 1))}
                maxValue={Math.ceil((max - offset) * 1.15) || 10}
                noOfSections={4}
                formatYLabel={(v: string) => String(Math.round(Number(v) + offset))}
                color="#66bb6a"
                thickness={3}
                dataPointsColor="#66bb6a"
                dataPointsRadius={5}
                yAxisTextStyle={{ color: "#aaa", fontSize: 11 }}
                xAxisLabelTextStyle={{ color: "#aaa", fontSize: 10 }}
                xAxisColor="#444"
                yAxisColor="#444"
                rulesColor="#2a2a2a"
                backgroundColor="#1e1e1e"
              />
            </View>
          )}

          <Text style={styles.secao}>Sessões</Text>
          {[...pontos].reverse().map((p, i) => (
            <View key={i} style={styles.sessao}>
              <Text style={styles.sessaoData}>{p.label}</Text>
              <Text style={styles.sessaoValor}>
                {arredondar(p.rm)} kg (1RM) · {arredondar(p.carga)} kg · vol. {Math.round(p.volume)}
              </Text>
            </View>
          ))}
          <Text style={styles.nota}>
            Somente séries válidas (sem aquecimento). 1RM = carga × (1 + reps ÷ 30), usando a melhor série da sessão.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#121212" },
  secao: { color: "#888", fontSize: 13, marginTop: 14, marginBottom: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: "#1e1e1e", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  chipAtivo: { backgroundColor: "#2e7d32" },
  chipTexto: { color: "#fff", fontSize: 14 },
  vazio: { color: "#888", textAlign: "center", marginTop: 32 },
  resumo: { flexDirection: "row", gap: 8, marginTop: 20 },
  caixa: { flex: 1, backgroundColor: "#1e1e1e", borderRadius: 10, padding: 12, alignItems: "center" },
  caixaTitulo: { color: "#888", fontSize: 12 },
  caixaValor: { color: "#fff", fontSize: 20, fontWeight: "600", marginTop: 4 },
  grafico: { backgroundColor: "#1e1e1e", borderRadius: 12, padding: 12, marginTop: 14, overflow: "hidden" },
  sessao: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#222" },
  sessaoData: { color: "#fff", fontSize: 15 },
  sessaoValor: { color: "#aaa", fontSize: 13 },
  nota: { color: "#666", fontSize: 12, marginTop: 16, textAlign: "center" },
});