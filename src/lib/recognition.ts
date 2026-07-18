export type PillarKey =
  | "resultados"
  | "excelencia"
  | "compromiso"
  | "colaboracion"
  | "orientacion_cliente"
  | "innovacion"
  | "liderazgo";

export type Pillar = {
  key: PillarKey;
  label: string;
  tagline: string;
  description: string;
  why: string;
};

// Fixed rubric defined by the user (not an editable catalog) — Colaborador
// Destacado del Mes evaluates every employee/leader against these 7 pillars.
export const PILLARS: Pillar[] = [
  {
    key: "resultados",
    label: "Resultados",
    tagline: "Cumple y hace que las cosas sucedan.",
    description:
      "Mide la capacidad del colaborador para alcanzar los objetivos de su puesto de manera constante, entregando resultados medibles y oportunos.",
    why: "Porque una empresa crece gracias a personas que convierten las tareas en resultados concretos.",
  },
  {
    key: "excelencia",
    label: "Excelencia",
    tagline: "Hace las cosas bien desde la primera vez.",
    description: "Evalúa la calidad del trabajo, la atención al detalle y el compromiso con minimizar errores.",
    why: "En e-commerce, un pequeño error puede convertirse en devoluciones, pérdidas económicas y clientes insatisfechos.",
  },
  {
    key: "compromiso",
    label: "Compromiso",
    tagline: "Actúa como si la empresa también fuera suya.",
    description:
      "Mide la responsabilidad, puntualidad, disciplina, ética y disposición para cumplir con las responsabilidades incluso en momentos de mayor exigencia.",
    why: "El compromiso es uno de los mejores predictores del desempeño sostenible a largo plazo.",
  },
  {
    key: "colaboracion",
    label: "Colaboración",
    tagline: "Crece ayudando a crecer a los demás.",
    description:
      "Evalúa la capacidad para trabajar en equipo, comunicarse con respeto, compartir información y construir un ambiente laboral positivo.",
    why: "Ningún departamento de e-commerce funciona aislado. Una buena coordinación entre áreas reduce errores y acelera los procesos.",
  },
  {
    key: "orientacion_cliente",
    label: "Orientación al Cliente",
    tagline: "Cada decisión mejora la experiencia del cliente.",
    description:
      "Mide cuánto comprende el colaborador que su trabajo impacta directamente en la satisfacción del cliente, incluso si no tiene contacto con él.",
    why: "En un negocio de e-commerce, todos trabajan para el mismo cliente, aunque no todos hablen con él.",
  },
  {
    key: "innovacion",
    label: "Innovación",
    tagline: "Siempre busca una mejor manera de hacer las cosas.",
    description: "Evalúa la iniciativa, la adaptación al cambio, el aprendizaje continuo y la búsqueda constante de mejoras en los procesos.",
    why: "Las empresas que mejoran continuamente son las que logran mantenerse competitivas.",
  },
  {
    key: "liderazgo",
    label: "Liderazgo",
    tagline: "Influye positivamente con su ejemplo.",
    description:
      "No se refiere a tener un cargo de jefe, sino a inspirar confianza, asumir responsabilidades, resolver problemas y ser un referente para sus compañeros.",
    why: "Los mejores colaboradores suelen convertirse en los futuros líderes de la organización.",
  },
];

export type BankQuestion = { id: string; text: string };

// 15 questions per pillar, so a fixed subset (see QUESTIONS_PER_PILLAR) can
// rotate randomly every evaluation without ever feeling repetitive.
export const QUESTION_BANK: Record<PillarKey, BankQuestion[]> = {
  resultados: [
    { id: "resultados_1", text: "¿Cumple con los objetivos y metas de su puesto de manera constante?" },
    { id: "resultados_2", text: "¿Entrega su trabajo a tiempo, sin necesidad de recordatorios constantes?" },
    { id: "resultados_3", text: "¿Los resultados que entrega son medibles y verificables?" },
    { id: "resultados_4", text: "¿Prioriza bien sus tareas para enfocarse en lo que realmente importa?" },
    { id: "resultados_5", text: "¿Cuando se le asigna una meta, hace lo necesario para alcanzarla?" },
    { id: "resultados_6", text: "¿Mantiene un ritmo de trabajo constante, no solo en rachas?" },
    { id: "resultados_7", text: "¿Es alguien en quien se puede confiar para que las cosas realmente sucedan?" },
    { id: "resultados_8", text: "¿Convierte los planes y las tareas en resultados concretos?" },
    { id: "resultados_9", text: "¿Cumple lo que promete dentro de los plazos acordados?" },
    { id: "resultados_10", text: "¿Su desempeño de este mes estuvo a la altura de lo esperado para su puesto?" },
    { id: "resultados_11", text: "¿Sabe manejar la presión sin sacrificar la calidad de sus resultados?" },
    { id: "resultados_12", text: "¿Hace seguimiento a sus propias tareas hasta que quedan completamente resueltas?" },
    { id: "resultados_13", text: "¿Sus resultados generan un impacto positivo visible para el equipo o la empresa?" },
    { id: "resultados_14", text: "¿Es consistente en su desempeño mes a mes, no solo en momentos puntuales?" },
    { id: "resultados_15", text: "¿Se puede contar con esta persona para cumplir objetivos difíciles?" },
  ],
  excelencia: [
    { id: "excelencia_1", text: "¿Su trabajo suele estar libre de errores?" },
    { id: "excelencia_2", text: "¿Presta atención a los detalles en las tareas que realiza?" },
    { id: "excelencia_3", text: "¿Revisa su propio trabajo antes de entregarlo?" },
    { id: "excelencia_4", text: "¿Hace las cosas bien desde la primera vez, sin necesitar corrección constante?" },
    { id: "excelencia_5", text: "¿Se esfuerza por entregar un trabajo de calidad, no solo \"cumplir el mínimo\"?" },
    { id: "excelencia_6", text: "¿Sus errores, cuando ocurren, son poco frecuentes y se corrigen rápido?" },
    { id: "excelencia_7", text: "¿Mantiene altos estándares incluso cuando nadie está supervisando?" },
    { id: "excelencia_8", text: "¿Su forma de trabajar reduce el riesgo de devoluciones o quejas de clientes?" },
    { id: "excelencia_9", text: "¿Se nota que le importa la calidad de lo que entrega?" },
    { id: "excelencia_10", text: "¿Es cuidadoso con la información y los procesos que maneja?" },
    { id: "excelencia_11", text: "¿Su trabajo genera confianza en quienes dependen de él?" },
    { id: "excelencia_12", text: "¿Busca hacer las cosas de la mejor manera posible, no solo la más rápida?" },
    { id: "excelencia_13", text: "¿Detecta errores propios antes de que se conviertan en un problema mayor?" },
    { id: "excelencia_14", text: "¿Cumple con los procedimientos y estándares establecidos?" },
    { id: "excelencia_15", text: "¿Su nivel de exigencia consigo mismo es alto?" },
  ],
  compromiso: [
    { id: "compromiso_1", text: "¿Es puntual en su horario y en sus responsabilidades?" },
    { id: "compromiso_2", text: "¿Actúa con responsabilidad incluso cuando nadie lo está supervisando?" },
    { id: "compromiso_3", text: "¿Mantiene una conducta ética y honesta en su trabajo diario?" },
    { id: "compromiso_4", text: "¿Está dispuesto a dar más de sí en momentos de mayor exigencia?" },
    { id: "compromiso_5", text: "¿Cumple con la disciplina y las normas del equipo?" },
    { id: "compromiso_6", text: "¿Trata los recursos y el tiempo de la empresa como si fueran propios?" },
    { id: "compromiso_7", text: "¿Se puede confiar en que cumplirá sus responsabilidades sin necesidad de vigilancia?" },
    { id: "compromiso_8", text: "¿Muestra compromiso incluso en tareas que no le resultan agradables?" },
    { id: "compromiso_9", text: "¿Su actitud ante el trabajo demuestra sentido de pertenencia con la empresa?" },
    { id: "compromiso_10", text: "¿Es constante en su compromiso, no solo cuando conviene?" },
    { id: "compromiso_11", text: "¿Asume las consecuencias de sus propias decisiones y errores?" },
    { id: "compromiso_12", text: "¿Respeta los acuerdos y compromisos que hace con su equipo?" },
    { id: "compromiso_13", text: "¿Se ausenta o llega tarde con poca frecuencia?" },
    { id: "compromiso_14", text: "¿Su nivel de compromiso se mantiene estable incluso en momentos difíciles?" },
    { id: "compromiso_15", text: "¿Demuestra lealtad hacia el equipo y hacia la empresa?" },
  ],
  colaboracion: [
    { id: "colaboracion_1", text: "¿Trabaja bien en equipo con sus compañeros?" },
    { id: "colaboracion_2", text: "¿Se comunica con respeto, incluso en desacuerdos?" },
    { id: "colaboracion_3", text: "¿Comparte información útil con su equipo sin guardársela para sí mismo?" },
    { id: "colaboracion_4", text: "¿Contribuye a un ambiente laboral positivo?" },
    { id: "colaboracion_5", text: "¿Ayuda a otros compañeros cuando lo necesitan, aunque no sea su tarea directa?" },
    { id: "colaboracion_6", text: "¿Se coordina bien con otras áreas cuando el trabajo lo requiere?" },
    { id: "colaboracion_7", text: "¿Escucha las ideas y opiniones de los demás?" },
    { id: "colaboracion_8", text: "¿Evita generar conflictos innecesarios dentro del equipo?" },
    { id: "colaboracion_9", text: "¿Es una persona con la que los demás disfrutan trabajar?" },
    { id: "colaboracion_10", text: "¿Reconoce el trabajo y los logros de sus compañeros?" },
    { id: "colaboracion_11", text: "¿Está dispuesto a ceder o adaptarse por el bien del equipo?" },
    { id: "colaboracion_12", text: "¿Fomenta la buena comunicación entre las personas con las que trabaja?" },
    { id: "colaboracion_13", text: "¿Ayuda a que su equipo crezca, no solo a que él mismo destaque?" },
    { id: "colaboracion_14", text: "¿Su presencia mejora el ambiente de trabajo del equipo?" },
    { id: "colaboracion_15", text: "¿Es alguien confiable con quien coordinar tareas conjuntas?" },
  ],
  orientacion_cliente: [
    { id: "orientacion_cliente_1", text: "¿Entiende cómo su trabajo impacta en la experiencia del cliente final?" },
    { id: "orientacion_cliente_2", text: "¿Toma decisiones pensando en el beneficio del cliente, aunque no tenga contacto directo con él?" },
    { id: "orientacion_cliente_3", text: "¿Se preocupa por que su trabajo no genere errores que afecten al cliente?" },
    { id: "orientacion_cliente_4", text: "¿Actúa con la mentalidad de que todos trabajan para el mismo cliente?" },
    { id: "orientacion_cliente_5", text: "¿Es cuidadoso en los procesos que eventualmente llegan al cliente?" },
    { id: "orientacion_cliente_6", text: "¿Muestra empatía al pensar en cómo se siente el cliente con el servicio recibido?" },
    { id: "orientacion_cliente_7", text: "¿Busca mejorar procesos que, directa o indirectamente, afectan la experiencia del cliente?" },
    { id: "orientacion_cliente_8", text: "¿Prioriza la satisfacción del cliente por encima de la comodidad personal?" },
    { id: "orientacion_cliente_9", text: "¿Entiende el impacto de su área dentro de la cadena que llega al cliente?" },
    { id: "orientacion_cliente_10", text: "¿Reacciona con responsabilidad cuando un error puede afectar a un cliente?" },
    { id: "orientacion_cliente_11", text: "¿Su trabajo refleja una preocupación genuina por la experiencia de compra?" },
    { id: "orientacion_cliente_12", text: "¿Ayuda a prevenir devoluciones o quejas con su forma de trabajar?" },
    { id: "orientacion_cliente_13", text: "¿Se pone en el lugar del cliente al tomar decisiones en su área?" },
    { id: "orientacion_cliente_14", text: "¿Entiende que cada decisión, por pequeña que sea, puede afectar al cliente?" },
    { id: "orientacion_cliente_15", text: "¿Demuestra vocación de servicio en su forma de trabajar?" },
  ],
  innovacion: [
    { id: "innovacion_1", text: "¿Propone ideas para mejorar procesos en su área?" },
    { id: "innovacion_2", text: "¿Se adapta bien a los cambios dentro de la empresa?" },
    { id: "innovacion_3", text: "¿Busca aprender cosas nuevas que le ayuden a hacer mejor su trabajo?" },
    { id: "innovacion_4", text: "¿Toma la iniciativa para resolver problemas sin esperar instrucciones?" },
    { id: "innovacion_5", text: "¿Cuestiona formas de trabajo ineficientes buscando una mejor manera?" },
    { id: "innovacion_6", text: "¿Se muestra abierto a probar nuevas herramientas o métodos de trabajo?" },
    { id: "innovacion_7", text: "¿Aporta soluciones creativas cuando surgen problemas?" },
    { id: "innovacion_8", text: "¿Aprende de sus errores y ajusta su forma de trabajar?" },
    { id: "innovacion_9", text: "¿Se mantiene actualizado en temas relevantes para su puesto?" },
    { id: "innovacion_10", text: "¿Muestra curiosidad por mejorar constantemente lo que hace?" },
    { id: "innovacion_11", text: "¿No se conforma con \"así se ha hecho siempre\" cuando hay una mejor opción?" },
    { id: "innovacion_12", text: "¿Sus ideas han generado mejoras reales en su área?" },
    { id: "innovacion_13", text: "¿Se adapta con buena actitud cuando cambian las prioridades?" },
    { id: "innovacion_14", text: "¿Busca activamente formas de ser más eficiente en su trabajo?" },
    { id: "innovacion_15", text: "¿Muestra iniciativa propia sin necesidad de que se lo pidan?" },
  ],
  liderazgo: [
    { id: "liderazgo_1", text: "¿Inspira confianza en las personas que lo rodean?" },
    { id: "liderazgo_2", text: "¿Es un buen ejemplo a seguir para sus compañeros, tenga o no un cargo de líder?" },
    { id: "liderazgo_3", text: "¿Asume responsabilidades incluso cuando no es obligatorio?" },
    { id: "liderazgo_4", text: "¿Ayuda a resolver problemas en lugar de solo señalarlos?" },
    { id: "liderazgo_5", text: "¿Es un referente positivo dentro de su equipo?" },
    { id: "liderazgo_6", text: "¿Influye positivamente en el ánimo y la actitud de sus compañeros?" },
    { id: "liderazgo_7", text: "¿Toma decisiones con responsabilidad cuando la situación lo requiere?" },
    { id: "liderazgo_8", text: "¿Motiva a los demás con su ejemplo, no solo con palabras?" },
    { id: "liderazgo_9", text: "¿Se anima a proponer soluciones en lugar de esperar que alguien más lo haga?" },
    { id: "liderazgo_10", text: "¿Demuestra madurez para manejar situaciones difíciles?" },
    { id: "liderazgo_11", text: "¿Los demás lo buscan como referencia cuando tienen dudas?" },
    { id: "liderazgo_12", text: "¿Tiene potencial para asumir más responsabilidad en el futuro?" },
    { id: "liderazgo_13", text: "¿Se hace cargo de las consecuencias de las decisiones del equipo cuando participa en ellas?" },
    { id: "liderazgo_14", text: "¿Genera un impacto positivo más allá de sus tareas asignadas?" },
    { id: "liderazgo_15", text: "¿Demuestra la capacidad de guiar a otros, aunque sea de manera informal?" },
  ],
};

// Fixed count (within the user's requested 3-5 range) so every evaluation
// has the same maximum possible score — otherwise someone whose leader
// picked 5 questions on a pillar would have an unfair ceiling over someone
// who got 3.
export const QUESTIONS_PER_PILLAR = 4;
export const MAX_SCORE_PER_QUESTION = 5;
export const MAX_TOTAL_SCORE = PILLARS.length * QUESTIONS_PER_PILLAR * MAX_SCORE_PER_QUESTION; // 140

function seededRandom(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic per (evaluator, evaluatee, month, pillar) — the same
// evaluation always shows the same questions on reload, but a different
// evaluator/evaluatee/month combination gets a different random subset, so
// it never feels repetitive without being inconsistent mid-evaluation.
export function pickQuestions(evaluatorId: string, evaluateeId: string, month: string, pillar: PillarKey): BankQuestion[] {
  const bank = QUESTION_BANK[pillar];
  const rand = seededRandom(`${evaluatorId}:${evaluateeId}:${month}:${pillar}`);
  return seededShuffle(bank, rand).slice(0, QUESTIONS_PER_PILLAR);
}

export function findQuestionText(pillar: string, questionId: string): string {
  const bank = QUESTION_BANK[pillar as PillarKey];
  return bank?.find((q) => q.id === questionId)?.text ?? questionId;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type RawEvaluation = {
  evaluateeId: string;
  comment: string | null;
  scores: { pillar: string; questionId: string; score: number }[];
  evaluatee: {
    id: string;
    name: string;
    photoUrl: string | null;
    isLeader: boolean;
    department: { name: string } | null;
  };
};

export type RankedPerson = {
  rank: number;
  userId: string;
  name: string;
  photoUrl: string | null;
  deptName: string | null;
  isLeader: boolean;
  totalScore: number;
  pillarScores: Record<PillarKey, number>;
  comment: string | null;
  answers: { pillar: string; questionId: string; questionText: string; score: number }[];
};

// Turns a month's raw evaluations into a strictly-ordered ranking — the user
// was explicit that the displayed ranking must never show a tie. A pure
// numeric tie on totalScore is astronomically unlikely with 28 individually
// scored questions, but not mathematically impossible, so this breaks any
// remaining tie deterministically: highest "Resultados" pillar score, then
// highest "Compromiso", then alphabetically — guaranteeing a strict order
// every time without needing an admin decision for the common case.
export function rankEvaluations(evaluations: RawEvaluation[]): RankedPerson[] {
  const rows: Omit<RankedPerson, "rank">[] = evaluations.map((ev) => {
    const pillarScores = {} as Record<PillarKey, number>;
    let total = 0;
    for (const s of ev.scores) {
      const key = s.pillar as PillarKey;
      pillarScores[key] = (pillarScores[key] ?? 0) + s.score;
      total += s.score;
    }
    return {
      userId: ev.evaluateeId,
      name: ev.evaluatee.name,
      photoUrl: ev.evaluatee.photoUrl,
      deptName: ev.evaluatee.department?.name ?? null,
      isLeader: ev.evaluatee.isLeader,
      totalScore: total,
      pillarScores,
      comment: ev.comment,
      answers: ev.scores
        .map((s) => ({ pillar: s.pillar, questionId: s.questionId, questionText: findQuestionText(s.pillar, s.questionId), score: s.score }))
        .sort((a, b) => a.pillar.localeCompare(b.pillar)),
    };
  });

  rows.sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      (b.pillarScores.resultados ?? 0) - (a.pillarScores.resultados ?? 0) ||
      (b.pillarScores.compromiso ?? 0) - (a.pillarScores.compromiso ?? 0) ||
      a.name.localeCompare(b.name)
  );

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
