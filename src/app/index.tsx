import { useEffect, useState } from 'react';

import { registerForPushNotifications } from '../services/notificationService';

import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ReviewSheet } from '@/components/ReviewSheet';
import { colors, radius, spacing, text } from '@/theme/theme';

import AuthScreen from '../features/Auth/AuthScreen';
import { useAuth } from '../features/Auth/useAuth';
import { signOut } from '../services/authService';
import {
  interpretText,
  type InterpretationResponse,
} from '../services/interpretationService';

export default function HomeScreen() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>
          Loading Kandoo...
        </Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return <KandooHome userEmail={user?.email ?? ''} />;
}

type KandooHomeProps = {
  userEmail: string;
};

function KandooHome({ userEmail }: KandooHomeProps) {
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [review, setReview] = useState<{
    rawText: string;
    response: InterpretationResponse;
  } | null>(null);

  useEffect(() => {
    registerForPushNotifications()
      .then((token) => {
        if (token) {
          console.log(
            'Kandoo push token registered:',
            token
          );
        }
      })
      .catch((error) => {
        console.error(
          'Push notification registration error:',
          error
        );
      });
  }, []);

  async function handleAddCapture() {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      setMessage(
        'Please enter something for Kandoo to remember.'
      );
      return;
    }

    setMessage('');
    setIsThinking(true);

    try {
      const response = await interpretText(trimmedInput);

      setInput('');
      setReview({ rawText: trimmedInput, response });
    } catch (error) {
      console.error('Kandoo interpretation error:', error);

      if (error instanceof Error) {
        setMessage(`Could not process: ${error.message}`);
      } else {
        setMessage('Could not process your request.');
      }
    } finally {
      setIsThinking(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      setMessage('Signed out.');
    } catch (error) {
      console.error('Sign out error:', error);

      if (error instanceof Error) {
        setMessage(`Sign out failed: ${error.message}`);
      } else {
        setMessage('Sign out failed.');
      }
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kandoo</Text>

      <Text style={styles.subtitle}>
        What happened?
      </Text>

      {userEmail !== '' && (
        <Text style={styles.userEmail}>
          {userEmail}
        </Text>
      )}

      <TextInput
        style={styles.input}
        placeholder="Tell Kandoo what's on your mind..."
        placeholderTextColor={colors.inkFaint}
        value={input}
        onChangeText={setInput}
        editable={!isThinking}
      />

      <Pressable
        style={[styles.addButton, isThinking && styles.addButtonDisabled]}
        onPress={handleAddCapture}
        disabled={isThinking}
      >
        <Text style={styles.addButtonText}>
          {isThinking ? 'Working it out…' : 'Add'}
        </Text>
      </Pressable>

      {message !== '' && (
        <Text style={styles.message}>
          {message}
        </Text>
      )}

      <Pressable
        style={styles.signOutButton}
        onPress={handleSignOut}
      >
        <Text style={styles.signOutButtonText}>
          Sign out
        </Text>
      </Pressable>

      {review ? (
        <ReviewSheet
          visible
          summary={review.response.summary}
          confidence={review.response.confidence}
          results={review.response.results}
          rawText={review.rawText}
          onClose={() => setReview(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.base,
  },

  loadingText: {
    ...text.bodyStrong,
    color: colors.ink,
  },

  container: {
    flex: 1,
    padding: spacing.space5,
    justifyContent: 'center',
    backgroundColor: colors.base,
  },

  title: {
    ...text.displayXl,
    textAlign: 'center',
    color: colors.ink,
  },

  subtitle: {
    ...text.bodyL,
    textAlign: 'center',
    marginTop: spacing.space3,
    marginBottom: spacing.space3,
    color: colors.inkMuted,
  },

  userEmail: {
    ...text.caption,
    textAlign: 'center',
    marginBottom: spacing.space5,
    color: colors.inkFaint,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.space4,
    ...text.bodyL,
    color: colors.ink,
    backgroundColor: colors.surface,
    marginBottom: spacing.space2,
  },

  addButton: {
    backgroundColor: colors.accent,
    padding: spacing.space4,
    borderRadius: radius.md,
    marginTop: 2,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },

  addButtonDisabled: {
    opacity: 0.6,
  },

  addButtonText: {
    ...text.bodyStrong,
    color: colors.base,
  },

  message: {
    ...text.caption,
    marginTop: spacing.space3,
    textAlign: 'center',
    color: colors.inkMuted,
  },

  signOutButton: {
    marginTop: spacing.space6,
    padding: spacing.space3,
    alignItems: 'center',
  },

  signOutButtonText: {
    ...text.body,
    color: colors.inkMuted,
  },
});
