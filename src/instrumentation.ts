export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { startViralPostsScheduler } = await import("@/lib/viral-posts/scheduler");
      startViralPostsScheduler();
    } catch (err) {
      console.warn("[Instrumentation] No se pudo iniciar ViralPosts Scheduler:", err);
    }
  }
}
