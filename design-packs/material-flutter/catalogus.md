## Componenten (Material 3, uit `package:flutter/material.dart`)
- **FilledButton**, **OutlinedButton**, **TextButton**, **IconButton**: knoppen. Voorbeeld: `FilledButton(onPressed: () {}, child: Text('Opslaan'))`
- **TextField**: invoerveld. Props: `controller`, `decoration: InputDecoration(labelText: 'Naam')`, `obscureText`, `keyboardType`.
- **Card**: kaart voor gegroepeerde inhoud. Voorbeeld: `Card(child: Padding(padding: EdgeInsets.all(16), child: Text('Hoi')))`
- **Scaffold**, **AppBar**, **NavigationBar**, **Drawer**: schermopbouw en navigatie.
- **ListTile**, **ListView**: lijsten. Props: `title`, `subtitle`, `leading`, `trailing`, `onTap`.
- **Switch**, **Checkbox**, **Radio**, **Slider**, **DropdownMenu**: keuzes en instellingen.
- **AlertDialog**, **SnackBar**, **BottomSheet**: meldingen en bevestigingen (`showDialog`, `ScaffoldMessenger.of(context).showSnackBar`).
- **Chip**, **Badge**, **Divider**, **CircularProgressIndicator**, **LinearProgressIndicator**: kleine onderdelen.
- **Row**, **Column**, **Wrap**, **Padding**, **SizedBox**, **Expanded**: indeling.
