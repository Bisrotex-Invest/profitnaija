/**
 * Photo picking helper — returns a small, self-contained data URI.
 *
 * Why a data URI instead of a file path?
 * - Picker URIs point at a temporary cache that the OS can clear.
 * - Local file paths / blob: URLs don't survive web reloads and can never
 *   resolve on another device when stored in Firestore.
 * A resized+compressed JPEG data URI (~20-40 KB) is durable everywhere and
 * safely below Firestore's 1 MB document limit.
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Ask for library permission, let the user pick + square-crop a photo,
 * then downscale it to `size`px wide and return it as a JPEG data URI.
 * Returns null if permission was denied, the user cancelled, or processing failed.
 */
export async function pickPhotoAsDataUri(size = 300): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission needed', 'Please allow access to your photo library to add a photo.');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1, // compress later, after resizing
  });
  if (result.canceled || !result.assets[0]?.uri) return null;

  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [{ resize: { width: size } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    if (!manipulated.base64) throw new Error('no base64 output');
    return `data:image/jpeg;base64,${manipulated.base64}`;
  } catch (e) {
    console.warn('[photo] could not process image:', e);
    Alert.alert('Photo error', 'Could not process that image. Please try another one.');
    return null;
  }
}
