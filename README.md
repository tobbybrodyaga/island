# Island — Dynamic Island для Windows

Чёрный компактный остров поверх окон: задачи, секундомеры, Pomodoro.

```mermaid
flowchart LR
    user(["Вы"])

    subgraph ui["Интерфейс: React"]
        direction TB
        capsule["Капсула<br/>таймер и задача"]
        panel["Панель<br/>8 вкладок"]
        capsule <-->|"клик, Esc"| panel
    end

    subgraph core["Electron"]
        direction TB
        window["Окно и трей"]
        watch["Буфер обмена"]
        window ~~~ watch
    end

    subgraph out["Данные и стекло"]
        direction TB
        state[("island-state.json")]
        excel[("Задачник.xlsx")]
        glass["IslandBackdrop.exe"]
        state ~~~ excel ~~~ glass
    end

    user --> ui
    ui <-->|"IPC"| core
    core --> out

    classDef island fill:#000000,stroke:#3a3a3c,color:#ffffff
    classDef accent fill:#0a84ff,stroke:#0a84ff,color:#ffffff
    classDef result fill:#1c1c1e,stroke:#30d158,color:#ffffff
    class capsule,panel island
    class window,watch accent
    class state,excel,glass result
    style ui fill:transparent,stroke:#8e8e93
    style core fill:transparent,stroke:#8e8e93
    style out fill:transparent,stroke:#8e8e93
```

Как всё устроено внутри: [блок-схемы работы острова](docs/ARCHITECTURE.md).

## Требования

- Windows 10/11
- Node.js 20+ (LTS)

## Запуск

```bash
cd island
npm install
npm run dev
```

Откроется прозрачное окно-остров у верхнего края экрана.

## Как пользоваться

- **Клик** — панель задач (~560×320)
- **Перетаскивание** — остров магнитится к краям экрана
- **Esc** или кнопка − — свернуть
- У каждой задачи свой **секундомер** (старт / пауза / сброс)
- **Pomodoro** внизу панели привязан к активной задаче: фокус запускает её секундомер
- Подзадачи — в строке задачи
- Выполненная задача зачёркивается

## Bitrix24

Пока заглушка в `src/integrations/bitrix.ts`. На следующем этапе — webhook Bitrix24.

## Сборка

```bash
npm run build
npm run preview
```

Данные хранятся локально в `userData` Electron (`island-state.json`).
