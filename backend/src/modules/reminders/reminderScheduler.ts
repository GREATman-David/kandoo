import { supabase } from '../../services/supabase';
import { sendNotification } from '../notifications/notificationService';

export async function processDueReminders() {
  const now = new Date().toISOString();

  const { data: reminders, error } = await supabase
    .from('reminders')
    .select(
      'id, user_id, task, person, reminder_time, status'
    )
    .eq('status', 'pending')
    .lte('reminder_time', now)
    .order('reminder_time', {
      ascending: true,
    });

  if (error) {
    console.error(
      'Database reminder scheduler error:',
      error
    );

    throw new Error(
      'Failed to retrieve due reminders.'
    );
  }

  for (const reminder of reminders) {
    await sendNotification({
      userId: reminder.user_id,
      title: 'Kandoo Reminder',
      body: reminder.person
        ? `Remember to ${reminder.task} with ${reminder.person}.`
        : `Remember to ${reminder.task}.`,
    });

    const { error: updateError } = await supabase
      .from('reminders')
      .update({
        status: 'completed',
      })
      .eq('id', reminder.id)
      .eq('status', 'pending');

    if (updateError) {
      console.error(
        'Failed to update reminder status:',
        updateError
      );
    }
  }

  return reminders;
}