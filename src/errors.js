export class GateError extends Error {
  constructor(code, diagnostics) { super(code); this.code = code; this.diagnostics = diagnostics; }
}
