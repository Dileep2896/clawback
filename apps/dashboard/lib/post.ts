/** Posts to one of the dashboard's own routes. False covers a refusal and a lost connection alike: the panel says try again either way. */
export async function post(url: string, body: unknown) {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return response.ok;
  } catch {
    return false;
  }
}
