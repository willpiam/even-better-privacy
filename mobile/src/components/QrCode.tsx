import React from 'react';
import qrcode from 'qrcode-generator';
import Svg, {Path, Rect} from 'react-native-svg';

export function qrImage(value: string) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const modules = qr.getModuleCount();
  const path: string[] = [];
  // Four white modules give scanners the required quiet zone.
  const margin = 4;
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (qr.isDark(row, col))
        path.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return {path: path.join(''), size: modules + margin * 2};
}

export default function QrCode({
  image,
  size,
  label,
}: {
  image: ReturnType<typeof qrImage>;
  size: number;
  label: string;
}) {
  return (
    <Svg
      accessible
      accessibilityLabel={label}
      width={size}
      height={size}
      viewBox={`0 0 ${image.size} ${image.size}`}>
      <Rect width={image.size} height={image.size} fill="#fff" />
      <Path d={image.path} fill="#000" />
    </Svg>
  );
}
