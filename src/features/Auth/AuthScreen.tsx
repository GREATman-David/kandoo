import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ForgotPasswordSheet } from '@/components/ForgotPasswordSheet';
import { KandooSymbol } from '@/components/Symbol';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

import { authErrorMessage, signIn, signUp } from '../../services/authService';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Errors read in alarm colour; a notice (e.g. "account created") reads muted.
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      setError('Enter your email and password to continue.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (isCreatingAccount) {
        await signUp(email.trim(), password);
        setNotice('Account created. Check your email if confirmation is needed.');
      } else {
        await signIn(email.trim(), password);
        // On success the session changes and this screen unmounts — no message.
      }
    } catch (caught) {
      // Log the raw cause; show the person one plain, mapped line (never .message).
      console.error('Authentication error:', caught);
      setError(authErrorMessage(caught, isCreatingAccount ? 'signup' : 'signin'));
    } finally {
      setLoading(false);
    }
  }

  const buttonLabel = loading
    ? isCreatingAccount
      ? 'Creating account…'
      : 'Signing in…'
    : isCreatingAccount
      ? 'Create account'
      : 'Sign in';

  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        {/* Brand lockup: wordmark, motto, mark — stacked and centred. */}
        <View style={styles.lockup}>
          <Text style={styles.wordmark}>Kandoo</Text>
          <Text style={styles.signature}>Yes You Kan</Text>
          <KandooSymbol state="idle" size={72} />
        </View>

        <TextInput
          style={styles.field}
          placeholder="Email"
          placeholderTextColor={colors.inkFaint}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!loading}
        />

        <TextInput
          style={[styles.field, styles.fieldGap]}
          placeholder="Password"
          placeholderTextColor={colors.inkFaint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          editable={!loading}
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDim]}
          onPress={handleSubmit}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.buttonLabel}>{buttonLabel}</Text>
        </Pressable>

        <Pressable
          style={styles.toggle}
          onPress={() => {
            setIsCreatingAccount((current) => !current);
            setError(null);
            setNotice(null);
          }}
          disabled={loading}
          accessibilityRole="button"
        >
          <Text style={styles.toggleText}>
            {isCreatingAccount ? 'Already have an account? ' : 'Need an account? '}
            <Text style={styles.toggleAccent}>
              {isCreatingAccount ? 'Sign in' : 'Create one'}
            </Text>
          </Text>
        </Pressable>

        {!isCreatingAccount ? (
          <Pressable
            style={styles.forgot}
            onPress={() => setForgotOpen(true)}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={styles.forgotText}>Forgot your password?</Text>
          </Pressable>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      </View>

      <ForgotPasswordSheet
        visible={forgotOpen}
        onClose={() => setForgotOpen(false)}
        initialEmail={email.trim()}
      />
    </View>
  );
}

const FIELD_HEIGHT = 48;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-width column with a comfortable side gutter — the fields and button
  // stretch across like the rest of the app, not capped to a narrow card.
  stack: {
    width: '100%',
    paddingHorizontal: spacing.space5,
    alignItems: 'center',
  },

  // Brand lockup —————————————————————————————————————————————
  lockup: {
    alignItems: 'center',
    gap: spacing.space3,
    marginBottom: spacing.space6,
  },
  wordmark: {
    ...text.wordmark,
    color: colors.markOuter,
    textAlign: 'center',
  },
  signature: {
    fontFamily: fontFamily.displayItalic,
    fontSize: 18,
    lineHeight: 22,
    color: colors.markRing,
    textAlign: 'center',
  },

  // Fields ———————————————————————————————————————————————————
  field: {
    ...text.body,
    alignSelf: 'stretch',
    height: FIELD_HEIGHT,
    paddingHorizontal: spacing.space4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  fieldGap: {
    marginTop: spacing.space3,
  },

  // Primary button ———————————————————————————————————————————
  button: {
    alignSelf: 'stretch',
    height: FIELD_HEIGHT,
    marginTop: spacing.space5,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDim: {
    opacity: 0.6,
  },
  buttonLabel: {
    ...text.bodyStrong,
    color: colors.ink,
  },

  // Account toggle ———————————————————————————————————————————
  toggle: {
    marginTop: spacing.space5,
    alignItems: 'center',
    minHeight: 24,
    justifyContent: 'center',
  },
  toggleText: {
    ...text.body,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  toggleAccent: {
    ...text.bodyStrong,
    color: colors.markRing,
  },

  // Secondary ————————————————————————————————————————————————
  forgot: {
    marginTop: spacing.space3,
    alignItems: 'center',
    minHeight: 32,
    justifyContent: 'center',
  },
  forgotText: {
    ...text.caption,
    color: colors.inkFaint,
  },
  error: {
    ...text.caption,
    marginTop: spacing.space4,
    textAlign: 'center',
    color: colors.alarmText,
  },
  notice: {
    ...text.caption,
    marginTop: spacing.space4,
    textAlign: 'center',
    color: colors.inkMuted,
  },
});
