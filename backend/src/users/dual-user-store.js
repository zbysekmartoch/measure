export class DualUserStore {
  constructor({ primaryStore, secondaryStore }) {
    this.primaryStore = primaryStore;
    this.secondaryStore = secondaryStore;
  }

  async init() {
    await this.primaryStore.init();
    await this.secondaryStore.init();
  }

  async findByEmail(email) {
    const fromPrimary = await this.primaryStore.findByEmail(email);
    if (fromPrimary) return fromPrimary;
    return this.secondaryStore.findByEmail(email);
  }

  async findById(id) {
    const fromPrimary = await this.primaryStore.findById(id);
    if (fromPrimary) return fromPrimary;
    return this.secondaryStore.findById(id);
  }

  async list() {
    const fromPrimary = await this.primaryStore.list();
    if (fromPrimary.length > 0) return fromPrimary;
    return this.secondaryStore.list();
  }

  async create(payload) {
    const created = await this.primaryStore.create(payload);

    this.secondaryStore.create(payload).catch((err) => {
      console.warn('[users] Dual write warning (secondary create failed):', err.message);
    });

    return created;
  }

  async updatePassword(id, passwordHash) {
    const updated = await this.primaryStore.updatePassword(id, passwordHash);

    this.secondaryStore.updatePassword(id, passwordHash).catch((err) => {
      console.warn('[users] Dual write warning (secondary password update failed):', err.message);
    });

    return updated;
  }
}
