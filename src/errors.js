export class GateError extends Error {
  constructor(code) { super(code); this.code = code; }
}
