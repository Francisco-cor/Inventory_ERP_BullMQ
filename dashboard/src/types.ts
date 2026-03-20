export interface EventEntry {
  eventId: string;
  eventName: string;
  source: string;
  correlationId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SlaAlert {
  ordenId: string;
  creadaEn: string;
  segundosPendiente: number;
  estadoSla: "pendiente" | "sla_warning";
}

export interface OrdenSla {
  ordenId: string;
  creadaEn: string;
  resueltaEn: string | null;
  estadoSla: "pendiente" | "confirmada" | "cancelada" | "sla_warning";
  duracionSegundos: number;
}
