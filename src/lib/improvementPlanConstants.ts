// Sin imports de servidor (prisma, notifications, etc.) a propósito — los
// componentes cliente de Plan de Mejora (ImprovementPlanDetail.tsx) importan
// esta lista directo de acá para no arrastrar todo el módulo de dominio
// (improvementPlan.ts, que sí usa Prisma) al bundle del navegador.
export const SUGGESTED_INDICATORS = [
  "Cumplimiento de responsabilidades",
  "Calidad del trabajo",
  "Productividad",
  "Puntualidad y cumplimiento",
  "Seguimiento de instrucciones",
  "Organización",
  "Comunicación",
  "Trabajo en equipo",
  "Actitud y disposición",
  "Mejora respecto a observaciones anteriores",
];
