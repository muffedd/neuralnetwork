# Research basis for the adaptive reading quest

The product uses a deliberately small, interpretable learner model before
attempting a population-trained neural model. It records correctness, selected
option, attempt count, response time, concept, and question error type. It does
not infer a learner's emotion from a wrong answer.

## Product decisions

1. **Read → retrieve → correct → retrieve again.** Retrieval practice improves
   delayed retention more than repeated study alone. Corrective feedback is
   shown after every answer.
2. **Trace skills, not a single global score.** The local model maintains
   separate mastery estimates for definition, relationship, sequence,
   cause-effect, and application questions.
3. **Use the selected wrong option.** Wrong options can reveal recurring error
   patterns that binary correct/incorrect labels hide.
4. **Semantic primacy before personalization.** Questions are first constrained
   to the current concept and its source evidence. Only then does the weakness
   profile choose the reasoning form. This prevents behavioral similarity from
   pulling the learner into an unrelated topic.
5. **Keep uncertainty visible.** A grey node means the learner exhausted three
   attempts; it is not proof that the concept is permanently unlearned.
6. **Avoid emotion guessing.** Affect detection research generally needs
   explicit self-report, dialogue, video, speech, or physiological signals.
   Incorrect answers alone are insufficient and can invite harmful
   overinterpretation.

## Primary research

- Roediger, H. L., & Karpicke, J. D. (2006). Test-Enhanced Learning:
  Taking Memory Tests Improves Long-Term Retention.
  https://doi.org/10.1111/j.1467-9280.2006.01693.x
- Pavlik, P. I., Cen, H., & Koedinger, K. R. (2009). Performance Factors
  Analysis – A New Alternative to Knowledge Tracing.
  https://files.eric.ed.gov/fulltext/ED506305.pdf
- Piech, C., et al. (2015). Deep Knowledge Tracing.
  https://papers.nips.cc/paper_files/paper/2015/hash/bac9162b47c56fc8a4d2a519803d51b3-Abstract.html
- Ghosh, A., Heffernan, N., & Lan, A. S. (2020). Context-Aware Attentive
  Knowledge Tracing. https://doi.org/10.1145/3394486.3403282
- Ghosh, A., Raspat, J., & Lan, A. (2021). Option Tracing: Beyond Correctness
  Analysis in Knowledge Tracing. https://arxiv.org/abs/2104.09043
- An, S., Kim, J., Kim, M., & Park, J. (2022). No Task Left Behind:
  Multi-Task Learning of Knowledge Tracing and Option Tracing for Better
  Student Assessment. https://doi.org/10.1609/aaai.v36i4.20364
- Ozyurt, Y., Feuerriegel, S., & Sachan, M. (2024). Automated Knowledge
  Concept Annotation and Question Representation Learning for Knowledge
  Tracing. https://arxiv.org/abs/2410.01727
- Cheng, W., et al. (2025). Uncertainty-aware Knowledge Tracing.
  https://doi.org/10.1609/aaai.v39i27.35007
- Kim, W., Lee, C., & Kim, H. (2026). KTCF: Actionable Recourse in Knowledge
  Tracing via Counterfactual Explanations for Education.
  https://doi.org/10.1609/aaai.v40i45.41216
- Gole, R., & Dacon, J. (2026). The Semantic Gap in Behavioral Embeddings:
  Why Linear Methods Fail for Educational RAG in Mathematics.
  https://educationaldatamining.org/edm2026/proceedings/2026.EDM.full-papers.184/

## Model roadmap

- **Now:** a private, browser-side Performance-Factors-style mastery estimator
  selects the weakest reasoning type. Gemini creates a source-grounded question
  for that type, with a deterministic local fallback.
- **After sufficient consented data:** compare the interpretable baseline with
  BKT/IRT, option tracing, AKT, and uncertainty-aware KT using held-out
  learners—not random interaction splits.
- **Before production personalization:** evaluate calibration, learning gains,
  cold start, subgroup performance, privacy, and whether recommendations help
  learners rather than merely predict their next answer.
