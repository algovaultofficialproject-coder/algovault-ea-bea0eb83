import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchAutoChart } from "./auto-chart.server";

export const getAutoChart = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ symbol: z.string().min(2).max(32) }).parse(input))
  .handler(({ data }) => fetchAutoChart(data.symbol));