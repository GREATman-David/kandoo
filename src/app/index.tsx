import { useEffect, useState } from 'react';

import { registerForPushNotifications } from '../services/notificationService';

import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import AuthScreen from '../features/Auth/AuthScreen';
import { useAuth } from '../features/Auth/useAuth';
import { useCapture } from '../features/Capture/useCapture';
import { signOut } from '../services/authService';
import { interpretText } from '../services/interpretationService';

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

  const { items, addCapture } = useCapture();

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

  setMessage('Kandoo is thinking...');

  try {
    const result = await interpretText(trimmedInput);

    console.log(
      'Kandoo interpretation:',
      result.interpretation
    );

    setInput('');

    if (result.interpretation.intent === 'create_reminder') {
      setMessage('Reminder created.');
    } else if (
      result.interpretation.intent === 'save_memory'
    ) {
      setMessage('Memory saved.');
    } else if (
      result.interpretation.intent === 'recall_memory'
    ) {
      setMessage(
        result.answer ?? 'Memory recalled.'
      );
    } else {
      setMessage(
        'Kandoo understood the request, but no action was taken.'
      );
    }
  } catch (error) {
    console.error(
      'Kandoo interpretation error:',
      error
    );

    if (error instanceof Error) {
      setMessage(
        `Could not process: ${error.message}`
      );
    } else {
      setMessage('Could not process your request.');
    }
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
        What can I help you remember?
      </Text>

      {userEmail !== '' && (
        <Text style={styles.userEmail}>
          {userEmail}
        </Text>
      )}

      <TextInput
        style={styles.input}
        placeholder="Tell Kandoo..."
        placeholderTextColor="#777B87"
        value={input}
        onChangeText={setInput}
      />

      <Pressable
        style={styles.addButton}
        onPress={handleAddCapture}
      >
        <Text style={styles.addButtonText}>
          Add
        </Text>
      </Pressable>

      {message !== '' && (
        <Text style={styles.message}>
          {message}
        </Text>
      )}

      {items.length > 0 && (
        <View style={styles.list}>
          {items.map((item, index) => (
            <Text key={index} style={styles.item}>
              {item.text}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>
        Today's reminders
      </Text>

      <Pressable
        style={styles.signOutButton}
        onPress={handleSignOut}
      >
        <Text style={styles.signOutButtonText}>
          Sign out
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B0D12',
  },

  loadingText: {
    color: '#F5F3EE',
    fontSize: 18,
    fontWeight: '600',
  },

  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#0B0D12',
  },

  title: {
    fontSize: 42,
    fontWeight: '800',
    textAlign: 'center',
    color: '#F5F3EE',
    letterSpacing: 1,
  },

  subtitle: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 12,
    color: '#A8A8B3',
  },

  userEmail: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    color: '#777B87',
  },

  input: {
    borderWidth: 1,
    borderColor: '#292D38',
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    color: '#F5F3EE',
    backgroundColor: '#151821',
    marginBottom: 10,
  },

  addButton: {
    backgroundColor: '#FFB86B',
    padding: 16,
    borderRadius: 16,
    marginTop: 2,
    alignItems: 'center',
  },

  addButtonText: {
    color: '#0B0D12',
    fontSize: 16,
    fontWeight: '700',
  },

  message: {
    marginTop: 14,
    textAlign: 'center',
    color: '#A8A8B3',
    fontSize: 14,
  },

  list: {
    marginTop: 24,
    gap: 10,
  },

  item: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#292D38',
    borderRadius: 14,
    fontSize: 16,
    color: '#F5F3EE',
    backgroundColor: '#151821',
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 40,
    color: '#F5F3EE',
  },

  signOutButton: {
    marginTop: 24,
    padding: 12,
    alignItems: 'center',
  },

  signOutButtonText: {
    color: '#A8A8B3',
    fontSize: 14,
    fontWeight: '600',
  },
});