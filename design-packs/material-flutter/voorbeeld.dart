import 'package:flutter/material.dart';
import 'theme/app_theme.dart';

void main() => runApp(const VoorbeeldApp());

class VoorbeeldApp extends StatelessWidget {
  const VoorbeeldApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        theme: AppTheme.licht(),
        darkTheme: AppTheme.donker(),
        home: Scaffold(
          appBar: AppBar(title: const Text('Welkom')),
          body: const Padding(
            padding: EdgeInsets.all(16),
            child: Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Dit is een voorbeeldpagina met Material-onderdelen.'),
                    SizedBox(height: 16),
                    TextField(decoration: InputDecoration(labelText: 'Je naam')),
                    SizedBox(height: 16),
                    FilledButton(onPressed: null, child: Text('Opslaan')),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}
