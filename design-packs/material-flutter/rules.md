# Regels voor Material (Flutter)
- Gebruik de standaard Material 3-widgets: `FilledButton`, `OutlinedButton`, `TextField`, `Card`, `AppBar`, `NavigationBar`, `ListTile`, `Dialog`, `SnackBar`.
- Kleuren en vormen komen uit het thema: `Theme.of(context).colorScheme` en `AppTheme.radiusMidden`. Nooit `Color(0x…)` of `TextStyle(fontFamily: …)` in een scherm.
- Eigen samengestelde widgets komen in `lib/widgets/app/` en bestaan uit Material-widgets.
- Ruimte met `SizedBox` en `Padding` in veelvouden van 8; gebruik `AppTheme.ruimteSchaal` voor de basis.
- Elke invoer krijgt een label (`InputDecoration(labelText: …)`); elke knop een duidelijke tekst.
