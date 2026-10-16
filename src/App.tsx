import { IslandShell } from './components/IslandShell';
import { useIslandStore } from './store/tasksStore';

/** Корневой компонент приложения Island */
export default function App() {
  const store = useIslandStore();

  return (
    <IslandShell
      ready={store.ready}
      error={store.error}
      tasks={store.tasksState.tasks}
      activityByDay={store.tasksState.activityByDay ?? {}}
      activeTask={store.activeTask}
      activeTaskId={store.tasksState.activeTaskId}
      settings={store.settings}
      now={store.now}
      onAdd={store.addTask}
      onActivate={store.setActiveTask}
      onToggleDone={store.toggleTaskDone}
      onRemove={store.removeTask}
      onRemoveMapStroke={store.removeMapStroke}
      onSetCategory={store.setTaskCategory}
      onSetWeight={store.setTaskWeight}
      onAddSubtask={store.addSubtask}
      onToggleSubtask={store.toggleSubtaskDone}
      onRemoveSubtask={store.removeSubtask}
      onUpdateTitle={store.updateTaskTitle}
      onUpdateSubtaskTitle={store.updateSubtaskTitle}
      onStartTimer={store.startStopwatch}
      onPauseTimer={store.pauseStopwatch}
      onResetTimer={store.resetStopwatch}
      onStartPomodoro={store.startPomodoro}
      onPausePomodoro={store.pausePomodoro}
      onStopPomodoro={store.stopPomodoro}
      onStartBreak={store.startBreak}
      onFocusMinutes={store.updateFocusMinutes}
      onBreakMinutes={store.updateBreakMinutes}
    />
  );
}
