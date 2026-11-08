import { Stack } from "expo-router";
import { SQLiteProvider } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { migrarBanco } from "../lib/db";
import { cores } from "../lib/tema";

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="treino.db" onInit={migrarBanco}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: cores.fundo },
          headerTintColor: cores.texto,
          headerTitleStyle: { fontWeight: "600" },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: cores.fundo },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="registrar" options={{ title: "Registrar treino" }} />
        <Stack.Screen name="editar" options={{ title: "Editar treino" }} />
        <Stack.Screen name="treino/[id]" options={{ title: "Treino" }} />
        <Stack.Screen name="sessao/[id]" options={{ title: "Treino de hoje" }} />
        <Stack.Screen name="grafico" options={{ title: "Gráfico" }} />
        <Stack.Screen name="corpo" options={{ title: "Peso e medidas" }} />
      </Stack>
    </SQLiteProvider>
  );
}