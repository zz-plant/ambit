export async function hasApi(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return (
      typeof health === 'object' && health !== null && 'status' in health && health.status === 'ok'
    );
  } catch {
    return false;
  }
}
