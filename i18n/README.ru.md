# @teamy.town/agent-workflow — Русский

[![npm version](https://img.shields.io/npm/v/@teamy.town/agent-workflow.svg)](https://www.npmjs.com/package/@teamy.town/agent-workflow)
[![CI](https://github.com/teamy-town/agent-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/teamy-town/agent-workflow/actions/workflows/ci.yml)
[![Types](https://img.shields.io/npm/types/@teamy.town/agent-workflow.svg)](https://www.npmjs.com/package/@teamy.town/agent-workflow)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)

[English](../README.md) | [Deutsch](./README.de.md) | [Español](./README.es.md) | [français](./README.fr.md) | [日本語](./README.ja.md) | [한국어](./README.ko.md) | [Português](./README.pt.md) | Русский | [中文](./README.zh.md)

📖 **Полная документация:** [docs.teamy.town](https://docs.teamy.town) · [Get Started](https://docs.teamy.town/get-started/install) · [Concepts](https://docs.teamy.town/concepts/graph) · [CLI Reference](https://docs.teamy.town/cli-reference) · [Cloud](https://docs.teamy.town/cloud/triggering)

> **Облачный конвейер для Claude Code, Codex и Gemini.** Объединяйте их в структурированные рабочие процессы с проверяемой через Zod передачей данных (handoff) между узлами. Независимый от поставщика, ориентированный на JavaScript, работает локально или в нашем облаке.

```
                ┌──────────┐    ┌──────────┐    ┌──────────┐
   trigger  →   │  plan    │ →  │ implement│ →  │  verify  │   →  result
                │ (claude) │    │ (codex)  │    │ (gemini) │
                └──────────┘    └──────────┘    └──────────┘
                     │               │               │
                  Zod out         Zod out         Zod out
```

Каждый узел передаёт управление полноценному агенту. Агент сам выполняет вызовы инструментов, правки файлов и многошаговые рассуждения. Ваш граф определяет, *какой* агент запускается *когда*, *какую схему* он обязан вернуть и *какое состояние* передаётся между ними.

Комбинируйте агентов по узлам — Claude для планирования, Codex для реализации, Gemini для проверки. Или используйте один. Решать вам:

```js
graph
  .addNode('plan',      { prompt, outputSchema: Plan,   agent: 'claude' })
  .addNode('implement', { prompt, outputSchema: Diff,   agent: 'codex'  })
  .addNode('verify',    { prompt, outputSchema: Result, agent: 'gemini' });
```

Каждый агент читает собственную переменную окружения с учётными данными (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). В **Teamy Cloud** их можно задавать для каждого рабочего процесса — разные ключи для разных конвейеров, без глобального состояния — см. [Per-workflow env vars](https://docs.teamy.town/cloud/env-vars). Переопределения `model` для отдельных узлов берутся из `.zibby.config.mjs` (`models: { node_id: 'claude-opus-4.6' }`), который CLI отправляет в облако в составе пакета развёртывания.

---

## Использование как библиотеки

Если вам не нужен CLI, переходите прямо в JavaScript:

```bash
npm install @teamy.town/agent-workflow
```

```js
import { Graph, AgentStrategy, registerStrategy } from '@teamy.town/agent-workflow';
import { z } from 'zod';

class MyAgent extends AgentStrategy {
  constructor() { super('mine', 'demo'); }
  canHandle() { return true; }
  async invoke(prompt, { schema }) {
    return { raw: '...', structured: { summary: 'hello' } };
  }
}
registerStrategy(new MyAgent());

const Plan = z.object({ tasks: z.array(z.string()) });
const Done = z.object({ summary: z.string() });

const graph = new Graph()
  .addNode('plan',   { prompt: 'List 3 tasks for: {{goal}}', outputSchema: Plan })
  .addNode('finish', { prompt: 'Summarise the work',         outputSchema: Done })
  .addEdge('plan', 'finish')
  .setEntryPoint('plan');

const { state } = await graph.run(null, {
  goal: 'add a dark-mode toggle',
  agentType: 'mine',
});

console.log(state.finish.summary);
```

См. [`examples/`](../examples/) для запускаемых демонстраций каждого паттерна.

---

## Чем это *не* является

| | Что делает | Чем мы отличаемся |
|---|---|---|
| **LangGraph** | Графовая среда выполнения с приоритетом Python поверх LangChain — узлы являются агентами LangChain или вызовами LLM, состояние разделяется через граф. | Наши узлы передают управление **внешним CLI кодинг-агентов** (Claude Code, OpenAI Codex, Gemini CLI) — независимым процессам, которые сами владеют использованием инструментов, многошаговыми циклами и правками файлов. С приоритетом JS, без взаимодействия с Python, без сборки LangChain. |
| **n8n / Zapier** | Визуальный редактор рабочих процессов — связывание SaaS API между собой. | С приоритетом кода, без UI. Построен вокруг композиции CLI кодинг-агентов применительно к вашему репозиторию, а не вокруг соединения SaaS API. |
| **CrewAI / AutoGen** | Многоагентная ролевая игра — агенты беседуют, чтобы решить задачу. | Никаких споров между агентами. Каждый узел — это отдельный вызов с проверкой по схеме. Детерминированные рёбра, удобство повторов. |

Если вы хотите объединить Claude Code + Codex + Gemini в один конвейер со структурированной передачей данных между ними — на JS, без Python, без LangChain — это именно то.

---

## Концепции

| Примитив | Что делает |
|---|---|
| `Graph` | Граф (DAG). `addNode`, `addEdge`, `addConditionalEdges`, `setEntryPoint`. |
| `Node` | Один вызов агента. Конфигурация: `prompt`, `outputSchema` (Zod), необязательные `agent`, `retries`, `skills`. |
| Узел-подграф | `addNode(name, { workflow: 'other-name', ... })` — диспетчеризует другой развёрнутый рабочий процесс как дочерний. Синхронно (опрос + слияние) или асинхронно (`async: true`, запуск без ожидания). См. [Подграфы](#подграфы) ниже. |
| `AgentStrategy` | Абстрактная база. Реализуйте `canHandle(ctx)` и `invoke(prompt, opts)`. |
| `registerStrategy()` | Сообщает движку, какие агенты доступны. Выбирается по полю узла `agent` → `config.agents[name]` → `state.agentType`. |
| `WorkflowState` | Состояние с отслеживанием истории, передаваемое между узлами. `set` / `update` / `append` / `rollback`. |
| Skills | Именованные наборы инструментов MCP, которые может запросить узел. `registerSkill({ id, serverName, tools, ... })`. |
| `ContextLoader` | Обходит каталог спецификации в поисках `CONTEXT.md` / `AGENTS.md` и сливает их в состояние. |
| `compileGraph()` | Собирает граф из конфигурации JSON (формат, который пишет Studio). |
| `timeline` | UX-индикатор прогресса CLI + структурированные маркеры `__WORKFLOW_GRAPH_LOG__`, которые потребляет Studio. |

Состояние передаётся автоматически: когда узел `plan` завершается с выводом `{ tasks: [...] }`, он попадает в `state.plan.tasks`, и узлы ниже по потоку его видят.

---

## Подграфы

**Узел-подграф** диспетчеризует другой развёрнутый рабочий процесс как дочерний по отношению к текущему. Полезно, когда шаг достаточно крупный, чтобы заслуживать собственной схемы состояния, собственной версии и собственной истории во вкладке активности, — но вы хотите, чтобы родитель вызывал его как часть большего потока.

Одно дополнительное поле в существующей конфигурации узла:

```js
g.addNode('audit', { workflow: 'deep-audit' });
```

Это вся поверхность функции. Никаких новых импортов, никакого UUID в пользовательском коде, никакого отдельного класса. Движок распознаёт `workflow:` и превращает узел в диспетчер подграфа.

**Синхронно или асинхронно** — это один флаг:

```js
g.addNode('audit',  { workflow: 'deep-audit' });                   // sync — parent blocks until child done
g.addNode('notify', { workflow: 'slack-notifier', async: true });  // fire-and-forget
```

**Прокладка состояния** — у каждого рабочего процесса своя схема; родитель преобразует своё состояние во вход дочернего и (по желанию) извлекает обратно то, что ему нужно:

```js
g.addNode('audit', {
  workflow: 'deep-audit',
  input:  (state) => ({ ticketId: state.ticketId }),
  output: 'auditResult.score',          // dot-path on child finalState
  // OR: output: (childState) => ({ score: childState.auditResult.score,
  //                                label: childState.auditResult.label }),
  retries: 3,                           // retry whole dispatch on transient failure
  timeoutMs: 5 * 60 * 1000,             // give up after 5min (sync mode only)
});
```

**Ошибки типизированы**, чтобы родители могли ветвиться:

| `err.code` | Когда |
|---|---|
| `SUBGRAPH_INVALID_INPUT` | `input:` родителя не удовлетворил stateSchema дочернего — сервер вернул 400 до запуска какого-либо Fargate |
| `SUBGRAPH_QUOTA_EXCEEDED` | Аккаунт превысил лимит выполнений; запуски подграфов считаются отдельно |
| `SUBGRAPH_TRIGGER_FAILED` | Любой другой сбой диспетчеризации |

**Та же конечная точка `/trigger`, что и у запусков, инициированных пользователем.** Движок выполняет POST на `/projects/<id>/workflows/<child-name>/trigger` с установленным `parentExecutionId`. Входной шлюз сервера, проверка квоты и учёт выполнений применяются одинаково — родитель, который разветвляется на 10 дочерних, потребляет 11 выполнений.

**Полный справочник:** [docs.teamy.town/concepts/sub-graphs](https://docs.teamy.town/concepts/sub-graphs)

---

## Примеры

| | Показывает |
|---|---|
| [01-hello-world](../examples/01-hello-world/) | Минимально возможный граф — один узел, один фиктивный агент. |
| [02-pipeline](../examples/02-pipeline/) | Три узла с **типизированной передачей** — `state.plan.tasks` перетекает в следующий узел. |
| [03-conditional-routing](../examples/03-conditional-routing/) | Ветвление по состоянию с `addConditionalEdges`. |
| [04-custom-agent](../examples/04-custom-agent/) | Подключите собственную `AgentStrategy` — напрямую вызывает OpenAI. |
| [05-with-skills](../examples/05-with-skills/) | Зарегистрируйте навык в стиле MCP, ограничьте его узлом. |

Запустите любой из них:

```bash
cd examples/01-hello-world
npm install
node index.js
```

Примеры 01–03 и 05 используют фиктивный агент — ключ API не требуется.

---

## Почему граф-из-агентов

Настоящие кодинг-агенты (Claude Code, OpenAI Codex, Gemini CLI) сами по себе являются полноценными средами выполнения — они правят файлы, запускают шеллы, вызывают инструменты MCP, обрабатывают многошаговые диалоги. Но сами по себе у них нет памяти между запусками и нет способа проверить собственный вывод.

Граф даёт вам:

- **Структурированную передачу** — узел A возвращает типизированный объект, узел B читает `state.A`. Никакого набивания промптов, никаких багов парсера.
- **Повторы в пределах узла** — плохой вывод? перезапустите только этот шаг.
- **Условную маршрутизацию** — `addConditionalEdges` для ветвления по состоянию.
- **Ограничение навыков** — узел A получает инструменты браузера; узел B получает инструменты git; они не мешают друг другу.
- **Воспроизведение / инспекцию** — каждый запуск попадает в папку сессии с исходными выводами, разобранным JSON и журналом выполнения в формате JSONL.
- **Интеграцию со Studio** — закрепите сессию, наблюдайте за состоянием в реальном времени, остановите запуск из UI.

Вы не заменяете агента. Вы даёте ему должностную инструкцию, контракт и место в конвейере.

---

## Статус

`0.1.x`. Публичная поверхность протокола стабильна и потребляется Teamy Studio + инструментами:

- `WORKFLOW_GRAPH_LOG_MARKER_PREFIX` (`__WORKFLOW_GRAPH_LOG__`)
- `STUDIO_STOP_REQUEST_FILE` (`.zibby-studio-stop`)
- триггер по переменной окружения `ZIBBY_RUN_SOURCE=studio`
- ключ возврата `stoppedByStudio: true`
- полезная нагрузка маркера `{ phase: 'node_begin' | 'node_end', node: string }`

JS API всё ещё до версии 1.0 — минорные версии могут добавлять или переименовывать элементы поверхности, кардинальные изменения будут отмечаться в примечаниях к выпуску.

---

## Лицензия

MIT
