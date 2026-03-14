export class Backend {
  constructor(name) {
    this.name = name;
  }

  canHandle(_segment, _ctx = {}) {
    return false;
  }

  async execute(_segment, _ctx = {}) {
    throw new Error(`${this.name} backend must implement execute(segment, ctx)`);
  }
}
