import { SUBMIT_DELAY_MS, typedForm } from './agentInput'

/** type `text` into an agent tab and press Enter; the tab must be awake — see `lib/agentInput` */
export async function submitToAgent(terminalId: string, text: string): Promise<void> {
  window.api.pty.input(terminalId, typedForm(text))
  await new Promise((r) => setTimeout(r, SUBMIT_DELAY_MS))
  window.api.pty.input(terminalId, '\r')
}
