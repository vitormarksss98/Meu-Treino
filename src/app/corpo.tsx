import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Keyboard,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { cores } from "../lib/tema";

const CAMPOS = [
  { k: "peso", nome: "Peso", abrev: "Peso", un: "kg" },
  { k: "gordura", nome: "Gordura corporal", abrev: "Gord.", un: "%" },
  { k: "cintura", nome: "Cintura", abrev: "Cint.", un: "cm" },
  { k: "quadril", nome: "Quadril", abrev: "Quad.", un: "cm" },
  { k: "peito", nome: "Peito", abrev: "Peit.", un: "cm" },
  { k: "braco_d", nome: "Braço direito", abrev: "Braço D", un: "cm" },
  { k: "braco_e", nome: "Braço esquerdo", abrev: "Braço E", un: "cm" },
  { k: "coxa_d", nome: "Coxa direita", abrev: "Coxa D", un: "cm" },
  { k: "coxa_e", nome: "Coxa esquerda", abrev: "Coxa E", un: "cm" },
  { k: "panturrilha", nome: "Panturrilha", abrev: "Pant.", un: "cm" },
] as const;

type Chave = (typeof CAMPOS)[number]["k"];
type Registro = { id: number; data: string } & Record<Chave, number | null>;
type Aba = "registrar" | "grafico" | "historico";

const vazio = (): Record<Chave, string> =>
  Object.fromEntries(CAMPOS.map((c) => [c.k, ""])) as Record<Chave, string>;

// ---------- utilitários ----------
function fmtISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
const hojeISO = () => fmtISO(new Date());
function somarDias(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return fmtISO(new Date(y, m - 1, d + n));
}
const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const dataCurta = (iso: string) => iso.split("-").reverse().slice(0, 2).join("/");
const fmtNum = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");
function parseNum(t: string): number | null {
  const n = parseFloat(t.replace(",", "."));
  return isNaN(n) || n <= 0 ? null : n;
}

// média dos pesos dos últimos 7 dias (inclui o dia)
function mediaMovel(todos: Registro[], iso: string) {
  const ini = somarDias(iso, -6);
  const v = todos
    .filter((r) => r.peso != null && r.data >= ini && r.data <= iso)
    .map((r) => r.peso as number);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

const ABAS: { chave: Aba; nome: string }[] = [
  { chave: "registrar", nome: "Registrar" },
  { chave: "grafico", nome: "Gráfico" },
  { chave: "historico", nome: "Histórico" },
];
const PERIODOS = [
  { dias: 30, nome: "30 dias" },
  { dias: 90, nome: "90 dias" },
  { dias: 0, nome: "Tudo" },
];

export default function Corpo() {
  const db = useSQLiteContext();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  const [aba, setAba] = useState<Aba>("registrar");
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [kb, setKb] = useState(0);

  // formulário
  const [data, setData] = useState(hojeISO());
  const [valores, setValores] = useState<Record<Chave, string>>(vazio());
  const [editandoId, setEditandoId] = useState<number | null>(null);

  // gráfico
  const [chave, setChave] = useState<Chave>("peso");
  const [dias, setDias] = useState(90);

  const carregar = useCallback(async () => {
    const l = await db.getAllAsync<Registro>(
      "SELECT * FROM medidas ORDER BY data DESC, id DESC"
    );
    setRegistros(l);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      carregar();
    }, [carregar])
  );

  useEffect(() => {
    const a = Keyboard.addListener("keyboardDidShow", (e) => setKb(e.endCoordinates.height));
    const b = Keyboard.addListener("keyboardDidHide", () => setKb(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  // marca d'água: último valor registrado de cada medida
  const ultimo = (k: Chave) => registros.find((r) => r[k] != null)?.[k] ?? null;

  function limparForm() {
    setValores(vazio());
    setData(hojeISO());
    setEditandoId(null);
  }

  async function salvar() {
    const nums = CAMPOS.map((c) => parseNum(valores[c.k]));
    if (nums.every((n) => n === null)) {
      Alert.alert("Nada para salvar", "Preencha pelo menos uma medida.");
      return;
    }
    const cols = CAMPOS.map((c) => c.k);
    if (editandoId !== null) {
      await db.runAsync(
        `UPDATE medidas SET data = ?, ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
        [data, ...nums, editandoId]
      );
    } else {
      await db.runAsync(
        `INSERT INTO medidas (data, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`,
        [data, ...nums]
      );
    }
    Keyboard.dismiss();
    limparForm();
    await carregar();
    Alert.alert("Salvo!", "Registro guardado.");
  }

  function editar(r: Registro) {
    setData(r.data);
    setValores(
      Object.fromEntries(
        CAMPOS.map((c) => [c.k, r[c.k] != null ? fmtNum(r[c.k] as number) : ""])
      ) as Record<Chave, string>
    );
    setEditandoId(r.id);
    setAba("registrar");
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function excluir(r: Registro) {
    Alert.alert("Excluir registro", `Excluir o registro de ${dataBR(r.data)}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          await db.runAsync("DELETE FROM medidas WHERE id = ?", r.id);
          if (editandoId === r.id) limparForm();
          carregar();
        },
      },
    ]);
  }

  // ---------- dados do gráfico ----------
  const corte = dias > 0 ? somarDias(hojeISO(), -dias) : "";
  const pontos = useMemo(
    () => registros.filter((r) => r[chave] != null && r.data >= corte).reverse(),
    [registros, chave, corte]
  );
  const valoresG = pontos.map((p) => p[chave] as number);
  const medias = chave === "peso" ? pontos.map((p) => mediaMovel(registros, p.data)) : [];
  const todos = [...valoresG, ...medias];
  const min = todos.length ? Math.min(...todos) : 0;
  const max = todos.length ? Math.max(...todos) : 0;
  const offset = Math.max(0, Math.floor(min * 0.95));
  const un = CAMPOS.find((c) => c.k === chave)!.un;
  const primeiro = valoresG[0];
  const fim = valoresG[valoresG.length - 1];
  const dif = valoresG.length > 1 ? fim - primeiro : null;

  const hoje = hojeISO();

  return (
    <View style={styles.container}>
      <View style={styles.abas}>
        {ABAS.map((a) => (
          <Pressable
            key={a.chave}
            style={[styles.aba, aba === a.chave && styles.abaAtiva]}
            onPress={() => setAba(a.chave)}
          >
            <Text style={styles.abaTexto}>{a.nome}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + kb }}
      >
        {/* ---------------- REGISTRAR ---------------- */}
        {aba === "registrar" && (
          <>
            {editandoId !== null && (
              <View style={styles.aviso}>
                <Text style={styles.avisoTexto}>Editando registro de {dataBR(data)}</Text>
                <Pressable onPress={limparForm}>
                  <Text style={styles.avisoLink}>Cancelar</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.dataLinha}>
              <Pressable hitSlop={12} onPress={() => setData(somarDias(data, -1))}>
                <Ionicons name="chevron-back" size={26} color={cores.texto} />
              </Pressable>
              <Text style={styles.dataTexto}>{data === hoje ? "Hoje · " : ""}{dataBR(data)}</Text>
              <Pressable
                hitSlop={12}
                disabled={data >= hoje}
                onPress={() => setData(somarDias(data, 1))}
              >
                <Ionicons
                  name="chevron-forward"
                  size={26}
                  color={data >= hoje ? "#444" : cores.texto}
                />
              </Pressable>
            </View>

            {CAMPOS.map((c, i) => {
              const u = ultimo(c.k);
              return (
                <View key={c.k} style={styles.campoLinha}>
                  <Text style={styles.campoNome}>{c.nome}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder={u != null ? fmtNum(u) : c.un}
                    placeholderTextColor="#6b6b6b"
                    value={valores[c.k]}
                    onChangeText={(t) => setValores((v) => ({ ...v, [c.k]: t }))}
                    onFocus={() =>
                      setTimeout(
                        () => scrollRef.current?.scrollTo({ y: 70 + i * 62, animated: true }),
                        150
                      )
                    }
                  />
                  <Text style={styles.unidade}>{c.un}</Text>
                </View>
              );
            })}

            <Text style={styles.dica}>
              Preencha só o que mediu. Os valores em cinza são do último registro.
            </Text>

            <Pressable style={styles.salvar} onPress={salvar}>
              <Text style={styles.salvarTexto}>
                {editandoId !== null ? "Salvar alterações" : "Salvar registro"}
              </Text>
            </Pressable>
          </>
        )}

        {/* ---------------- GRÁFICO ---------------- */}
        {aba === "grafico" && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {CAMPOS.map((c) => (
                <Pressable
                  key={c.k}
                  style={[styles.chip, chave === c.k && styles.chipAtivo]}
                  onPress={() => setChave(c.k)}
                >
                  <Text style={styles.chipTexto}>{c.abrev}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[styles.chips, { marginTop: 10 }]}>
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
              <Text style={styles.vazio}>Nenhum registro desta medida no período.</Text>
            ) : (
              <>
                <View style={styles.resumo}>
                  <View style={styles.caixa}>
                    <Text style={styles.caixaTitulo}>Último</Text>
                    <Text style={styles.caixaValor}>
                      {fmtNum(fim)} {un}
                    </Text>
                  </View>
                  <View style={styles.caixa}>
                    <Text style={styles.caixaTitulo}>Início</Text>
                    <Text style={styles.caixaValor}>
                      {fmtNum(primeiro)} {un}
                    </Text>
                  </View>
                  <View style={styles.caixa}>
                    <Text style={styles.caixaTitulo}>Variação</Text>
                    <Text style={styles.caixaValor}>
                      {dif === null ? "—" : `${dif > 0 ? "+" : ""}${fmtNum(dif)} ${un}`}
                    </Text>
                  </View>
                </View>

                {pontos.length < 2 ? (
                  <Text style={styles.vazio}>
                    Registre pelo menos 2 vezes para ver a linha de evolução.
                  </Text>
                ) : (
                  <View style={styles.grafico}>
                    <LineChart
                      data={valoresG.map((v, i) => ({
                        value: v - offset,
                        label: dataCurta(pontos[i].data),
                      }))}
                      data2={
                        medias.length ? medias.map((m) => ({ value: m - offset })) : undefined
                      }
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
                      color2="#42a5f5"
                      thickness2={2}
                      hideDataPoints2
                      yAxisTextStyle={{ color: "#aaa", fontSize: 11 }}
                      xAxisLabelTextStyle={{ color: "#aaa", fontSize: 10 }}
                      xAxisColor="#444"
                      yAxisColor="#444"
                      rulesColor="#2a2a2a"
                      backgroundColor="#1e1e1e"
                    />
                  </View>
                )}

                {medias.length > 0 && (
                  <Text style={styles.legenda}>
                    <Text style={{ color: "#66bb6a" }}>● peso registrado</Text>
                    {"   "}
                    <Text style={{ color: "#42a5f5" }}>— média dos últimos 7 dias</Text>
                  </Text>
                )}
              </>
            )}
          </>
        )}

        {/* ---------------- HISTÓRICO ---------------- */}
        {aba === "historico" && (
          <>
            {registros.length === 0 ? (
              <Text style={styles.vazio}>Nenhum registro ainda.</Text>
            ) : (
              registros.map((r) => (
                <View key={r.id} style={styles.item}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemData}>{dataBR(r.data)}</Text>
                    <Text style={styles.itemTexto}>
                      {CAMPOS.filter((c) => r[c.k] != null)
                        .map((c) => `${c.abrev} ${fmtNum(r[c.k] as number)}`)
                        .join(" · ")}
                    </Text>
                  </View>
                  <Pressable hitSlop={10} onPress={() => editar(r)}>
                    <Ionicons name="create-outline" size={22} color={cores.destaque} />
                  </Pressable>
                  <Pressable hitSlop={10} onPress={() => excluir(r)}>
                    <Ionicons name="trash-outline" size={22} color={cores.perigo} />
                  </Pressable>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  abas: {
    flexDirection: "row",
    margin: 16,
    marginBottom: 0,
    backgroundColor: cores.card,
    borderRadius: 12,
    padding: 4,
  },
  aba: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  abaAtiva: { backgroundColor: cores.primaria },
  abaTexto: { color: cores.texto, fontSize: 14, fontWeight: "600" },
  aviso: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#3a3217",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  avisoTexto: { color: cores.aviso, fontSize: 13 },
  avisoLink: { color: cores.texto, fontSize: 13, fontWeight: "700" },
  dataLinha: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: cores.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  dataTexto: { color: cores.texto, fontSize: 17, fontWeight: "600" },
  campoLinha: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  campoNome: { color: cores.texto, fontSize: 15, flex: 1.3 },
  input: {
    flex: 1,
    backgroundColor: cores.campo,
    color: cores.texto,
    borderRadius: 8,
    paddingVertical: 10,
    textAlign: "center",
    fontSize: 18,
  },
  unidade: { color: cores.suave, width: 28, fontSize: 13 },
  dica: { color: "#666", fontSize: 12, textAlign: "center", marginVertical: 8 },
  salvar: {
    backgroundColor: cores.primaria,
    paddingVertical: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
  },
  salvarTexto: { color: cores.texto, fontSize: 18, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { backgroundColor: cores.card, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  chipAtivo: { backgroundColor: cores.primaria },
  chipTexto: { color: cores.texto, fontSize: 14 },
  vazio: { color: cores.suave, textAlign: "center", marginTop: 32 },
  resumo: { flexDirection: "row", gap: 8, marginTop: 20 },
  caixa: { flex: 1, backgroundColor: cores.card, borderRadius: 10, padding: 12, alignItems: "center" },
  caixaTitulo: { color: cores.suave, fontSize: 12 },
  caixaValor: { color: cores.texto, fontSize: 16, fontWeight: "600", marginTop: 4 },
  grafico: { backgroundColor: cores.card, borderRadius: 12, padding: 12, marginTop: 14, overflow: "hidden" },
  legenda: { fontSize: 12, textAlign: "center", marginTop: 10 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: cores.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  itemData: { color: cores.texto, fontSize: 16, fontWeight: "600" },
  itemTexto: { color: cores.suave, fontSize: 13, marginTop: 4 },
});