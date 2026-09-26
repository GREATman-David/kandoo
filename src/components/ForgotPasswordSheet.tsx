import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authErrorMessage, sendPasswordReset } from '@/services/authService';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

export type ForgotPasswordSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Prefill from the sign-in field so the user rarely retypes it. */
  initialEmail?: string;
};

/**
 * Forgot-password sheet. Sends a Supabase reset email, shows one plain line on
 * success or failure — never a raw exception — and changes the button label
 * while sending instead of showing a spinner.
 */
export function ForgotPasswordSheet({
  visible,
  onClose,
  initialEmail,
}: ForgotPasswordSheetProps) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (visible) {
      setEmail(initialEmail ?? '');
      setError(null);
      setSent(false);
      setSending(false);
    }
  }, [visible, initialEmail]);

  async function submit() {
    const address = email.trim();
    if (!address) {
      setError('Enter the email you signed up with.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendPasswordReset(address);
      setSent(true);
    } catch (caught) {
      console.error('Password reset failed:', caught);
      setError(authErrorMessage(caught, 'reset'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.space6 }]}>
          <Text style={styles.title}>Reset your password</Text>

          {sent ? (
            <>
              <Text style={styles.body}>
                If an account exists for {email.trim()}, a reset link is on its
                way. Check your email.
              </Text>
              <Pressable style={styles.button} onPress={onClose}>
                <Text style={styles.buttonText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.body}>
                Enter your email and we'll send a link to set a new password.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={colors.inkFaint}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!sending}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                style={[styles.button, sending && styles.buttonDim]}
                onPress={submit}
                disabled={sending}
              >
                <Text style={styles.buttonText}>
                  {sending ? 'Sending…' : 'Send reset link'}
                </Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={onClose} disabled={sending}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withOpacity(colors.ink, 0.35),
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.space5,
    paddingTop: spacing.space6,
    gap: spacing.space4,
  },
  title: {
    ...text.displayL,
    color: colors.ink,
  },
  body: {
    ...text.body,
    color: colors.inkMuted,
  },
  input: {
    ...text.bodyL,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.space4,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  error: {
    ...text.caption,
    color: colors.alarmText,
  },
  button: {
    backgroundColor: colors.markCore,
    borderRadius: radius.md,
    paddingVertical: spacing.space4,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDim: {
    opacity: 0.6,
  },
  buttonText: {
    ...text.bodyStrong,
    color: colors.ink,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: spacing.space2,
  },
  cancelText: {
    ...text.body,
    color: colors.inkMuted,
  },
});
