export interface DashboardPresencePayload {
  userId?: string;
  userEmail?: string;
  userName?: string;
  pathname: string;
  search?: string;
  fullPath: string;
  activeTab?: string;
  moduleKey: string;
  moduleLabel: string;
  moduleDescription: string;
  visibilityState?: string;
  updatedAt: string;
}

export interface ResolvedDashboardModule {
  moduleKey: string;
  moduleLabel: string;
  moduleDescription: string;
}

export function resolveDashboardModuleInfo(pathname: string, search?: string): ResolvedDashboardModule {
  const cleanPath = (pathname || "/").replace(/^\/(es|en|pt-BR)(?=\/|$)/, "") || "/";
  const params = new URLSearchParams((search || "").replace(/^\?/, ""));
  const tab = (params.get("tab") || "").toLowerCase();

  if (cleanPath === "/" || cleanPath === "") {
    return {
      moduleKey: "overview",
      moduleLabel: "Dashboard Principal",
      moduleDescription:
        "Resumen ejecutivo, métricas de prospección, embudo CRM, evolución social y estado de sincronización.",
    };
  }

  if (cleanPath.startsWith("/linkedin-accounts")) {
    return {
      moduleKey: "accounts",
      moduleLabel: "Configuración de Cuentas de LinkedIn",
      moduleDescription:
        "Conexión de perfiles de LinkedIn (Hosted Auth / credenciales nativas), estado OK/ERROR, resolución de checkpoints 2FA y límites diarios seguros.",
    };
  }

  if (cleanPath.startsWith("/viral-posts")) {
    if (cleanPath.includes("/create") || tab === "create" || tab === "modeler") {
      return {
        moduleKey: "posts_create",
        moduleLabel: "Posts Virales · Crear / Modelar Post",
        moduleDescription:
          "Creación y modelado de publicaciones o carruseles con IA, definición de palabra clave Lead Magnet (Auto-DM) y publicación o programación.",
      };
    }
    if (cleanPath.includes("/list") || tab === "list" || tab === "posts") {
      return {
        moduleKey: "posts_list",
        moduleLabel: "Posts Virales · Lista de Publicaciones",
        moduleDescription:
          "Gestión de borradores, posts programados y publicaciones emitidas en LinkedIn con su link directo y sincronización de comentarios.",
      };
    }
    if (cleanPath.includes("/calendar") || tab === "calendar") {
      return {
        moduleKey: "posts_calendar",
        moduleLabel: "Posts Virales · Calendario Editorial",
        moduleDescription: "Vista calendario de publicaciones programadas y emitidas.",
      };
    }
    return {
      moduleKey: "posts_radar",
      moduleLabel: "Posts Virales · Radar Viral",
      moduleDescription:
        "Búsqueda de publicaciones virales en LinkedIn por nicho o tema para modelar contenido de autoridad.",
    };
  }

  if (cleanPath.startsWith("/signals")) {
    if (cleanPath.includes("/competitors")) {
      return {
        moduleKey: "signals_competitors",
        moduleLabel: "Signal Radar · Nivel 2 (Competidores)",
        moduleDescription:
          "Monitoreo de publicaciones de competidores y referentes para capturar prospectos que interactúan con ellos.",
      };
    }
    if (cleanPath.includes("/groups")) {
      return {
        moduleKey: "signals_groups",
        moduleLabel: "Signal Radar · Nivel 3 (Grupos y Eventos)",
        moduleDescription:
          "Captura de miembros e interacciones de grupos o eventos relevantes de LinkedIn.",
      };
    }
    if (cleanPath.includes("/global")) {
      return {
        moduleKey: "signals_global",
        moduleLabel: "Signal Radar · Nivel 4 (Radar Global por Palabras Clave)",
        moduleDescription:
          "Escaneo global en LinkedIn por palabras clave de intención comercial.",
      };
    }
    return {
      moduleKey: "signals_my_posts",
      moduleLabel: "Signal Radar · Nivel 1 (Mis Posts / Lead Magnet)",
      moduleDescription:
        "Monitoreo de comentarios y reacciones en tus propias publicaciones con Auto-Like y Auto-DM por palabra clave.",
    };
  }

  if (cleanPath.startsWith("/campaigns")) {
    return {
      moduleKey: "campaigns",
      moduleLabel: "Campañas de Prospección (Secuencias Lineales)",
      moduleDescription:
        "Configuración y ejecución de secuencias lineales multietapa (Visita -> Like/Comentario -> Conexión -> DM -> Follow-up) con pacing seguro Lun-Vie.",
    };
  }

  if (cleanPath.startsWith("/leads/lists")) {
    return {
      moduleKey: "leads_lists",
      moduleLabel: "CRM Leads 360° · Listas Inteligentes",
      moduleDescription: "Organización de listas segmentadas de prospectos y asignación a campañas.",
    };
  }

  if (cleanPath.startsWith("/leads")) {
    return {
      moduleKey: "leads",
      moduleLabel: "CRM Leads 360°",
      moduleDescription:
        "Base de prospectos capturados, puntajes de intención (intent score), perfil de LinkedIn y estado en secuencias.",
    };
  }

  if (cleanPath.startsWith("/inbox")) {
    return {
      moduleKey: "inbox",
      moduleLabel: "Smart Inbox Unificado",
      moduleDescription:
        "Mensajes directos de LinkedIn en tiempo real con borradores sugeridos por el Copilot SDR IA.",
    };
  }

  if (cleanPath.startsWith("/pipeline")) {
    return {
      moduleKey: "pipeline",
      moduleLabel: "Pipeline CRM (Tablero Kanban)",
      moduleDescription:
        "Gestión visual de oportunidades por etapa comercial hasta reunión agendada y cierre.",
    };
  }

  if (cleanPath.startsWith("/sdr")) {
    return {
      moduleKey: "sdr",
      moduleLabel: "SDR IA & Base de Conocimiento",
      moduleDescription:
        "Entrenamiento del conocimiento de empresa (RAG), reglas de tono, propuesta de valor y cola de aprobaciones SDR.",
    };
  }

  if (cleanPath.startsWith("/settings/security")) {
    return {
      moduleKey: "settings_security",
      moduleLabel: "Configuración · Seguridad y Pacing",
      moduleDescription: "Horarios seguros, límites diarios de LinkedIn y seguridad de la cuenta.",
    };
  }

  if (cleanPath.startsWith("/settings")) {
    return {
      moduleKey: "settings",
      moduleLabel: "Configuración General del Workspace",
      moduleDescription: "Preferencias del workspace, integraciones y parámetros generales.",
    };
  }

  if (cleanPath.startsWith("/team")) {
    return {
      moduleKey: "team",
      moduleLabel: "Gestión de Equipo",
      moduleDescription: "Miembros, roles e invitaciones del workspace.",
    };
  }

  if (cleanPath.startsWith("/plans")) {
    return {
      moduleKey: "plans",
      moduleLabel: "Planes y Suscripción",
      moduleDescription: "Plan actual, capacidad de cuentas de LinkedIn y facturación.",
    };
  }

  return {
    moduleKey: "other",
    moduleLabel: cleanPath,
    moduleDescription: `Página actual del Dashboard: ${cleanPath}`,
  };
}
