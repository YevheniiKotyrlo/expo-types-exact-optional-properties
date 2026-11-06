import {
  FlatList,
  Image,
  InputAccessoryView,
  Switch,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

type PanelProps = {
  readonly className?: string;
  readonly lang?: string;
  readonly visibility?: string;
  readonly textOverflow?: string;
};

function Panel({ className, lang, visibility, textOverflow }: PanelProps) {
  return (
    <View>
      <View className={className} />
      <Text className={className}>Text</Text>
      <FlatList className={className} data={[]} renderItem={() => null} />
      <Image className={className} />
      <Switch className={className} />
      <InputAccessoryView className={className}>
        <View />
      </InputAccessoryView>
      <TouchableWithoutFeedback className={className}>
        <View />
      </TouchableWithoutFeedback>
      <Text lang={lang}>Text</Text>
      <View style={{ visibility }} />
      <Text style={{ textOverflow }}>Text</Text>
    </View>
  );
}

export default function Index() {
  return <Panel className="panel" />;
}
