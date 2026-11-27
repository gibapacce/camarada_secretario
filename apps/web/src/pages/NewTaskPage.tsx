import { TaskForm } from '../components/TaskForm.tsx';
import { useApp } from '../lib/app-context.ts';
import { navigate } from '../lib/router.tsx';

export function NewTaskPage() {
  const { api, text, runAction } = useApp();
  return (
    <section aria-labelledby="new-title">
      <h1 id="new-title">{text.newTask}</h1>
      <TaskForm
        onCancel={() => window.history.back()}
        onSubmit={async (data) => {
          if (data.kind !== 'create') return;
          await runAction((key) => api.createTask(data.input, key), 'created', {
            undoable: true,
            title: data.input.title,
            onDone: (r) => r.ok && navigate(`/tarefas/${r.task.id}`, true),
          });
        }}
      />
    </section>
  );
}
