/** Заглушка интеграции с Bitrix24 (webhook появится на следующем этапе) */
export interface BitrixTask {
  id: string;
  title: string;
  done: boolean;
}

export interface BitrixClient {
  /** Загружает задачи текущего пользователя из Bitrix */
  fetchMyTasks: () => Promise<BitrixTask[]>;
  /** Синхронизирует статус выполнения задачи обратно в Bitrix */
  syncTaskStatus: (taskId: string, done: boolean) => Promise<void>;
}

/** Клиент-заглушка: методы есть, но интеграция ещё не подключена */
export const bitrixStub: BitrixClient = {
  async fetchMyTasks() {
    throw new Error('Bitrix24 ещё не подключён. Настройте webhook на следующем этапе.');
  },
  async syncTaskStatus() {
    throw new Error('Bitrix24 ещё не подключён. Настройте webhook на следующем этапе.');
  },
};

/** Проверяет, доступна ли реальная интеграция (пока всегда false) */
export function isBitrixConfigured(): boolean {
  return false;
}
