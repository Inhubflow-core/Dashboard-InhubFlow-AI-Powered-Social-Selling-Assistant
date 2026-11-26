/**
 * Conocimiento integral de la plataforma InhubFlow Social Selling Suite
 * y maestría en LinkedIn, Marca Personal y Prospección B2B.
 */
export const INHUBFLOW_MASTER_KNOWLEDGE = `
=== CONOCIMIENTO COMPLETO DE LA PLATAFORMA INHUBFLOW (SOCIAL SELLING SUITE) ===
InhubFlow Social Selling Suite es una plataforma SaaS B2B todo-en-uno para convertir la presencia en LinkedIn en reuniones comerciales calificadas sin spam ni riesgo de baneo.

1. MÓDULOS PRINCIPALES Y DÓNDE ESTÁN EN EL DASHBOARD:
- Panel Principal (/): KPIs en vivo (cuentas activas, prospectos CRM, campañas, publicaciones, pacing diario).
- Cuentas de LinkedIn (/linkedin-accounts): Conexión segura de perfiles vía Unipile (Hosted Auth, credenciales o cookie). Multi-cuenta según plan. Estado saludable = OK/CONNECTED.
- Viral Post Engine (/viral-posts):
  * Radar Viral (/viral-posts/radar): Busca publicaciones con mayor tracción en cualquier nicho y calcula su Viral Score.
  * Creador y Modelador IA (/viral-posts/create): Reescribe posts virales adaptándolos a la Base de Conocimiento (RAG) de la empresa; genera posts de texto, posts con imagen o carruseles PDF multi-diapositiva.
  * Editor Visual Integrado (Fabric.js): Diseña portadas, imágenes y carruseles PDF diapositiva por diapositiva, con buscador de imágenes Pixabay y removedor de fondo.
  * Calendario Editorial (/viral-posts/calendar): Programa publicaciones (ritmo recomendado: Lunes, Miércoles y Viernes) y las dispara automáticamente mediante /api/viral-posts/run-scheduled.
  * Lead Magnets en Posts: Palabra clave en CTA (ej. "SISTEMA") + Auto-Like a comentarios + Auto-DM automático entregando el recurso cuando alguien comenta.
- Signal Radar (/signals): Captura compradores con intención real en 4 fuentes:
  * Nivel 1 — Mis Posts (/signals/my-posts): Quienes comentan o reaccionan en tus propias publicaciones.
  * Nivel 2 — Competidores (/signals/competitors): Monitorea posts de competidores directos y captura prospectos que interactúan (filtrando automáticamente empleados internos del competidor).
  * Nivel 3 — Radar Global (/signals/global): Rastrea palabras clave y hashtags en todo LinkedIn.
  * Nivel 4 — Grupos (/signals/groups): Extrae miembros activos de comunidades relevantes.
- Campañas / Secuencias Lineales (/campaigns):
  * Secuencia humanizada recomendada: Visitar perfil → Like & Comentar último post → Seguir → Solicitud de conexión personalizada → DM Icebreaker contextualizado con la señal → Follow-ups (esperas de 1 a 3 días).
  * Blindaje Anti-Baneo: Opera en horario laboral (Lun–Vie) con pausas aleatorias y límite estricto de seguridad de hasta 20 invitaciones / acciones diarias por cuenta conectada vía Unipile.
  * Stop on Reply: Se detiene automáticamente en cuanto el prospecto responde para dar paso al SDR IA o al humano.
- Asistente SDR IA (/sdr) & Smart Inbox Unificado (/inbox):
  * Base de Conocimiento (RAG): Guarda perfil de empresa, productos/servicios, precios, objeciones y link de agenda (Calendly / Cal.com).
  * Modo Copiloto: Redacta respuestas fundamentadas para aprobación en 1 clic.
  * Modo Piloto Automático: Responde en menos de 2 minutos 24/7 y comparte el link de agenda.
  * Handoff a Humano: Transfiere si el prospecto pide hablar con una persona, muestra tono hostil, pide descuentos especiales (>10 cuentas) o la confianza es <80%.
- Pipeline CRM (/pipeline) & Leads 360 (/leads):
  * Tablero Kanban de 8 etapas de conversión con intent_score (0-100), listas segmentadas (/leads/lists) y exportación CSV.
- Equipo (/team) y Planes (/plans):
  * Starter ($49/mes o $39/mes anual, 1 cuenta, 20 inv/día, 30 DMs/día).
  * Growth ($149/mes o $119/mes anual, 5 cuentas, 100 inv/día, 150 DMs/día, SDR colaborativo).
  * Business ($279/mes o $223/mes anual, 10 cuentas, 200 inv/día, 300 DMs/día, API dedicada).

=== MAESTRÍA EN LINKEDIN, MARCA PERSONAL Y SOCIAL SELLING ===
Actúas también como estratega experto en LinkedIn, Marca Personal y Ventas Consultivas B2B:
1. Optimización de Perfil que Convierte:
   - Titular (Headline): [A quién ayudas] + [Resultado medible] + [Cómo lo logras], evitando títulos genéricos como solo "CEO en X".
   - Banner: Propuesta de valor visual clara + prueba social o CTA.
   - Acerca de (About): Estructura gancho en las primeras 3 líneas → Problema del cliente → Historia/autoridad y resultados → Cómo trabajas → CTA con link o palabra clave.
   - Destacados (Featured): Lead magnet principal, caso de éxito o link directo de agenda.
2. Estrategia de Contenido y Marca Personal:
   - Regla de oro del gancho: Las primeras 2 líneas deciden el 80% de las lecturas (contraste, error común, dato real o historia específica; nunca introducciones tibias).
   - Formatos que mejor convierten: Carruseles PDF educativos (frameworks, checklists, comparativas), posts de texto con historia + aprendizaje accionable, y casos reales con métricas.
   - Distribución inteligente: Responder comentarios en los primeros 60 minutos aumenta el alcance; combinar 2 posts de autoridad/dolor + 1 post con Lead Magnet por semana.
3. Prospección Consultiva sin Spam:
   - Regla de contexto: Nunca vender en la nota de conexión ni en el primer DM frío. Referenciar una señal real (un comentario suyo, un evento en común, un post reciente).
   - Calentamiento previo (visita + comentario con valor real en su post) multiplica la tasa de aceptación frente a envíos en frío.
   - Conversión a llamada: Diagnóstico corto por DM (1-2 preguntas sobre su situación actual) antes de enviar el enlace de agenda.
`.trim();
