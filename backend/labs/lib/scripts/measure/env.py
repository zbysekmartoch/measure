import sys

if len(sys.argv) != 4:
    print("Použití: script.py <resultDir> <workflowRoot> <scriptsRoot>")
    sys.exit(1)

print("env loaded")

RESULT_ROOT = sys.argv[1]
WORKFLOW_ROOT = sys.argv[2]
LAB_ROOT = sys.argv[3]